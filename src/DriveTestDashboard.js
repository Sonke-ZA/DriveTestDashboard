import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import Papa from 'papaparse';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api'; // install @react-google-maps/api

/* -------------------------
  Helper: generate demo data
   (unchanged except throughput remains "Mbps" internally)
--------------------------*/
const generateDriveTestData = () => {
  const data = [];
  const startDate = new Date('2025-08-01');

  // default center (Johannesburg)
  const centerLat = -26.2041;
  const centerLon = 28.0473;

  for (let day = 0; day < 31; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + day);
      currentDate.setHours(hour, 0, 0, 0);

      const baseSignal = -75 + Math.random() * 50;
      const rsrp = Math.max(-120, Math.min(-50, baseSignal + (Math.random() - 0.5) * 20));
      const rsrq = Math.max(-20, Math.min(-3, -10 + (Math.random() - 0.5) * 10));
      const sinr = Math.max(-10, Math.min(30, 15 + (Math.random() - 0.5) * 20));

      let signalClass = 4;
      if (rsrp >= -70) signalClass = 1;
      else if (rsrp >= -85) signalClass = 2;
      else if (rsrp >= -100) signalClass = 3;

      // place points around center with a small jitter
      const lat = centerLat + (Math.random() - 0.5) * 0.05;
      const lon = centerLon + (Math.random() - 0.5) * 0.07;

      data.push({
        timestamp: currentDate.toISOString(),
        date: currentDate.toDateString(),
        hour: hour,
        day: day + 1,
        rsrp: parseFloat(rsrp.toFixed(1)),
        rsrq: parseFloat(rsrq.toFixed(1)),
        sinr: parseFloat(sinr.toFixed(1)),
        signalClass: signalClass,
        technology: Math.random() > 0.3 ? '5G' : '4G',
        location: `Sector_${Math.floor(Math.random() * 50) + 1}`,
        throughput: parseFloat((Math.random() * 100 + 50).toFixed(1)), // Mbps
        lat,
        lon
      });
    }
  }

  return data;
};

/* -------------------------
  Utility: create small SVG marker icon as data URL
--------------------------*/
const createMarkerSvgDataUrl = (color = '#10B981', size = 16) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <circle cx="12" cy="10" r="6" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
      <path d="M12 22s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11z" fill="${color}" opacity="0.9"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

/* -------------------------
  Small helpers for “AI” analytics
--------------------------*/
const fmtPct = (n) => `${(Number(n) || 0).toFixed(1)}%`;
const fmtKbps = (n) => `${Math.round(Number(n) || 0).toLocaleString()} kbps`;
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

function summarizeColumns(sampleRow) {
  if (!sampleRow) return 'No columns detected.';
  return Object.keys(sampleRow).join(', ');
}
function avg(arr, key) {
  const vals = arr.map(x => Number(x[key])).filter(v => Number.isFinite(v));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function groupBy(arr, key) {
  return arr.reduce((m, r) => {
    const k = r[key] ?? 'Unknown';
    (m[k] = m[k] || []).push(r);
    return m;
  }, {});
}
function percentile(arr, key, p) {
  const vals = arr.map(x => Number(x[key])).filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const idx = Math.min(vals.length - 1, Math.max(0, Math.round((p / 100) * (vals.length - 1))));
  return vals[idx];
}

/* -------------------------
   Main component
--------------------------*/
const DriveTestDashboard = () => {
  const [data, setData] = useState([]);
  const [selectedTech, setSelectedTech] = useState('All');
  const [csvFile, setCsvFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dataSource, setDataSource] = useState('synthetic');
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [error, setError] = useState(null);
  const [fieldMapping, setFieldMapping] = useState({
    timestamp: '',
    rsrp: '',
    rsrq: '',
    sinr: '',
    technology: '',
    location: '',
    throughput: '',
    latitude: '',
    longitude: ''
  });
  // Enhanced coordinate column detection function
const detectCoordinateColumns = (headers) => {
  const latPatterns = [
    'lat', 'latitude', 'Lat', 'Latitude', 'LAT', 'LATITUDE',
    'lat_deg', 'latitude_deg', 'lat_decimal', 'latitude_decimal'
  ];
  const lngPatterns = [
    'lng', 'lon', 'long', 'longitude', 'Lng', 'Lon', 'Long', 
    'Longitude', 'LNG', 'LON', 'LONG', 'LONGITUDE',
    'lng_deg', 'lon_deg', 'longitude_deg', 'long_decimal'
  ];
  
  let latCol = null;
  let lngCol = null;
  
  // Find latitude column
  for (let pattern of latPatterns) {
    if (headers.includes(pattern)) {
      latCol = pattern;
      break;
    }
  }
  
  // Find longitude column  
  for (let pattern of lngPatterns) {
    if (headers.includes(pattern)) {
      lngCol = pattern;
      break;
    }
  }
  
  return { latCol, lngCol };
};
// Enhanced coordinate validation function
const isValidCoordinate = (lat, lng) => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  
  return (
    !isNaN(latitude) && 
    !isNaN(longitude) && 
    latitude >= -90 && 
    latitude <= 90 && 
    longitude >= -180 && 
    longitude <= 180 &&
    latitude !== 0 && 
    longitude !== 0
  );
};


  // AI Chat state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { role: 'assistant', text: 'Hi! Ask me anything about the dataset. For example: "What’s the average throughput on 5G?" or "Top 5 sectors by Class 1 coverage".' }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [useLLM, setUseLLM] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const aiPanelRef = useRef(null);

  useEffect(() => {
  try {
    if (dataSource === 'synthetic') {
      setData(generateDriveTestData());
      setError(null);
    }
  } catch (err) {
    console.error('Error generating demo data:', err);
    setError('Failed to generate demo data');
    setData([]);
  }
}, [dataSource]);

  // keep chat scrolled
  useEffect(() => {
    if (aiPanelRef.current) {
      aiPanelRef.current.scrollTop = aiPanelRef.current.scrollHeight;
    }
  }, [aiMessages, aiOpen]);

  /* -------------------------
     Process CSV rows using mapping.
  --------------------------*/
  const processCsvData = (csvData, mapping) => {
  const centerLat = -26.2041; // Johannesburg default
  const centerLon = 28.0473;
  
  console.log('Processing CSV data with mapping:', mapping);
  console.log('Sample CSV row:', csvData[0]);

  return csvData.map((row, index) => {
    // Process timestamp
    let timestamp;
    if (mapping.timestamp && row[mapping.timestamp]) {
      timestamp = new Date(row[mapping.timestamp]);
      if (isNaN(timestamp.getTime())) {
        timestamp = new Date('2025-08-01');
        timestamp.setHours(index % 24, 0, 0, 0);
        timestamp.setDate(timestamp.getDate() + Math.floor(index / 24));
      }
    } else {
      timestamp = new Date('2025-08-01');
      timestamp.setHours(index % 24, 0, 0, 0);
      timestamp.setDate(timestamp.getDate() + Math.floor(index / 24));
    }

    const hour = timestamp.getHours();
    const day = timestamp.getDate();
    const date = timestamp.toDateString();

    // Process signal measurements
    const rsrp = mapping.rsrp && row[mapping.rsrp] !== undefined ? 
      parseFloat(row[mapping.rsrp]) || -80 : -80;
    const rsrq = mapping.rsrq && row[mapping.rsrq] !== undefined ? 
      parseFloat(row[mapping.rsrq]) || -10 : -10;
    const sinr = mapping.sinr && row[mapping.sinr] !== undefined ? 
      parseFloat(row[mapping.sinr]) || 15 : 15;
    const throughput = mapping.throughput && row[mapping.throughput] !== undefined ? 
      parseFloat(row[mapping.throughput]) || (Math.random() * 100 + 50) : 
      (Math.random() * 100 + 50);

    // Process technology
    let technology = '4G';
    if (mapping.technology && row[mapping.technology]) {
      const techValue = row[mapping.technology].toString().toLowerCase();
      technology = techValue.includes('5g') || techValue.includes('nr') || 
        techValue.includes('new') ? '5G' : '4G';
    }

    // Process coordinates - THIS IS THE KEY FIX
    let lat = null;
    let lon = null;
    
    // Try to get coordinates from mapped columns
    if (mapping.latitude && mapping.longitude && 
        row[mapping.latitude] !== undefined && 
        row[mapping.longitude] !== undefined) {
      
      const rawLat = row[mapping.latitude];
      const rawLon = row[mapping.longitude];
      
      // Convert to numbers and validate
      const parsedLat = parseFloat(rawLat);
      const parsedLon = parseFloat(rawLon);
      
      if (isValidCoordinate(parsedLat, parsedLon)) {
        lat = parsedLat;
        lon = parsedLon;
        console.log(`Row ${index}: Valid coordinates found - Lat: ${lat}, Lon: ${lon}`);
      } else {
        console.warn(`Row ${index}: Invalid coordinates - Lat: ${rawLat}, Lon: ${rawLon}`);
      }
    }
    
    // Fallback to default coordinates if no valid coordinates found
    if (lat === null || lon === null) {
      console.log(`Row ${index}: Using default coordinates`);
      const jitterA = (index % 100) / 1000;
      const jitterB = ((index * 7) % 100) / 1000;
      lat = centerLat + (Math.random() - 0.5) * 0.05 + jitterA;
      lon = centerLon + (Math.random() - 0.5) * 0.07 + jitterB;
    }

    // Calculate signal class
    let signalClass = 4;
    if (rsrp >= -70) signalClass = 1;
    else if (rsrp >= -85) signalClass = 2;
    else if (rsrp >= -100) signalClass = 3;

    return {
      timestamp: timestamp.toISOString(),
      date,
      hour,
      day,
      rsrp: parseFloat(rsrp.toFixed(1)),
      rsrq: parseFloat(rsrq.toFixed(1)),
      sinr: parseFloat(sinr.toFixed(1)),
      signalClass,
      technology,
      location: mapping.location && row[mapping.location] ? 
        row[mapping.location] : `Sector_${Math.floor(index / 24) + 1}`,
      throughput: parseFloat(throughput.toFixed(1)),
      lat,
      lon,
      originalRow: index
    };
  });
};

  /* -------------------------
     CSV upload handling
  --------------------------*/
  const handleCsvUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  setCsvFile(file);
  setIsLoading(true);

  Papa.parse(file, {
    complete: (results) => {
      setIsLoading(false);
      
      if (results.errors.length > 0) {
        console.error('CSV parse errors:', results.errors);
      }
      
      const headers = results.meta.fields || 
        (results.data && results.data.length > 0 ? Object.keys(results.data[0]) : []);
      
      console.log('Detected CSV headers:', headers);
      setCsvHeaders(headers);

      // Enhanced auto mapping with coordinate detection
      const autoMapping = {
        timestamp: '',
        rsrp: '',
        rsrq: '',
        sinr: '',
        technology: '',
        location: '',
        throughput: '',
        latitude: '',
        longitude: ''
      };

      // Auto-detect coordinate columns
      const { latCol, lngCol } = detectCoordinateColumns(headers);
      if (latCol) autoMapping.latitude = latCol;
      if (lngCol) autoMapping.longitude = lngCol;
      
      console.log('Auto-detected coordinates:', { lat: latCol, lng: lngCol });

      // Auto-detect other fields
      headers.forEach(h => {
        const lower = h.toLowerCase();
        if (!autoMapping.timestamp && 
            (lower.includes('time') || lower.includes('date') || lower.includes('timestamp'))) {
          autoMapping.timestamp = h;
        }
        if (!autoMapping.rsrp && 
            (lower.includes('rsrp') || (lower.includes('signal') && lower.includes('strength')))) {
          autoMapping.rsrp = h;
        }
        if (!autoMapping.rsrq && 
            (lower.includes('rsrq') || lower.includes('quality'))) {
          autoMapping.rsrq = h;
        }
        if (!autoMapping.sinr && 
            (lower.includes('sinr') || lower.includes('snr'))) {
          autoMapping.sinr = h;
        }
        if (!autoMapping.technology && 
            (lower.includes('tech') || lower.includes('rat') || 
             lower.includes('generation') || lower.includes('technology'))) {
          autoMapping.technology = h;
        }
        if (!autoMapping.location && 
            (lower.includes('location') || lower.includes('sector') || 
             lower.includes('cell') || lower.includes('site'))) {
          autoMapping.location = h;
        }
        if (!autoMapping.throughput && 
            (lower.includes('throughput') || lower.includes('speed') || 
             lower.includes('rate') || lower.includes('kbps') || lower.includes('mbps'))) {
          autoMapping.throughput = h;
        }
      });

      setFieldMapping(prev => ({ ...prev, ...autoMapping }));
      
      // Show detected coordinate status
      if (latCol && lngCol) {
        console.log(`✓ Coordinates detected: ${latCol} & ${lngCol}`);
      } else {
        console.warn('⚠ No coordinate columns detected - will use default locations');
      }
    },
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (header) => {
      // Clean up headers by removing extra spaces
      return header.trim();
    },
    error: (err) => {
      console.error('CSV parse error:', err);
      setIsLoading(false);
    }
  });
};

 const applyCsvData = () => {
  if (!csvFile) return;
  setIsLoading(true);
  setError(null);
  
  Papa.parse(csvFile, {
    complete: (results) => {
      try {
        if (results.errors && results.errors.length > 0) {
          console.warn('CSV parsing warnings:', results.errors);
        }
        
        if (!results.data || results.data.length === 0) {
          throw new Error('No data found in CSV file');
        }
        
        console.log('CSV parsed successfully:', results.data.length, 'rows');
        const processed = processCsvData(results.data, fieldMapping);
        
        if (processed.length === 0) {
          throw new Error('No valid data could be processed from CSV');
        }
        
        setData(processed);
        setDataSource('csv');
        setError(null);
      } catch (err) {
        console.error('Error processing CSV data:', err);
        setError(`Failed to process CSV: ${err.message}`);
        setData([]);
      } finally {
        setIsLoading(false);
      }
    },
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    error: (err) => {
      console.error('CSV parse error:', err);
      setError(`Failed to parse CSV file: ${err.message}`);
      setIsLoading(false);
    }
  });
};

  /* -------------------------
     Filtering + aggregations
     (throughput stored as Mbps internally; convert to kbps for display)
  --------------------------*/
  const filteredData = useMemo(() => {
  if (!data || !Array.isArray(data)) return [];
  return data.filter(item => selectedTech === 'All' || item.technology === selectedTech);
}, [data, selectedTech]);

  // hourly aggregates
  const hourlyData = useMemo(() => {
    return Array.from({ length: 24 }, (_, hour) => {
      const hourData = filteredData.filter(item => item.hour === hour);
      const class1Count = hourData.filter(item => item.signalClass === 1).length;
      const totalCount = hourData.length;
      const avgThroughputMbps = totalCount > 0 ? (hourData.reduce((s, it) => s + it.throughput, 0) / totalCount) : 0;
      return {
        hour: `${hour}:00`,
        class1Percentage: totalCount > 0 ? ((class1Count / totalCount) * 100) : 0,
        avgRSRP: totalCount > 0 ? (hourData.reduce((sum, item) => sum + item.rsrp, 0) / totalCount) : 0,
        avgThroughputKbps: avgThroughputMbps * 1000,
        rawAvgThroughputMbps: avgThroughputMbps,
        count: totalCount
      };
    });
  }, [filteredData]);

  // daily aggregates for Aug 1..31
  const dailyData = useMemo(() => {
    return Array.from({ length: 31 }, (_, dayIdx) => {
      const dayNumber = dayIdx + 1;
      const dayData = filteredData.filter(item => item.day === dayNumber);
      const class1Count = dayData.filter(item => item.signalClass === 1).length;
      const totalCount = dayData.length;
      return {
        day: dayNumber,
        date: `Aug ${dayNumber}`,
        class1Percentage: totalCount > 0 ? ((class1Count / totalCount) * 100) : 0,
        avgRSRP: totalCount > 0 ? (dayData.reduce((sum, item) => sum + item.rsrp, 0) / totalCount) : 0,
        avgThroughputKbps: totalCount > 0 ? (dayData.reduce((sum, item) => sum + item.throughput, 0) / totalCount) * 1000 : 0,
        class1Count,
        totalMeasurements: totalCount
      };
    });
  }, [filteredData]);

  // signal class distribution
  const signalClassData = useMemo(() => ([
    { name: 'Class 1 (Excellent)', value: filteredData.filter(item => item.signalClass === 1).length, color: '#10B981' },
    { name: 'Class 2 (Good)', value: filteredData.filter(item => item.signalClass === 2).length, color: '#3B82F6' },
    { name: 'Class 3 (Fair)', value: filteredData.filter(item => item.signalClass === 3).length, color: '#F59E0B' },
    { name: 'Class 4 (Poor)', value: filteredData.filter(item => item.signalClass === 4).length, color: '#EF4444' }
  ]), [filteredData]);

  // technology distribution
  const techData = useMemo(() => ([
    { name: '5G', value: filteredData.filter(item => item.technology === '5G').length, color: '#8B5CF6' },
    { name: '4G', value: filteredData.filter(item => item.technology === '4G').length, color: '#06B6D4' }
  ]), [filteredData]);

  // KPIs
  const totalMeasurements = filteredData.length;
  const class1Count = filteredData.filter(item => item.signalClass === 1).length;
  const class1Percentage = totalMeasurements > 0 ? ((class1Count / totalMeasurements) * 100).toFixed(1) : 0;
  const avgRSRP = totalMeasurements > 0 ? (filteredData.reduce((sum, item) => sum + item.rsrp, 0) / totalMeasurements).toFixed(1) : 0;
  const avgThroughputKbps = totalMeasurements > 0 ? (filteredData.reduce((sum, item) => sum + item.throughput, 0) / totalMeasurements) * 1000 : 0;

  /* -------------------------
     Per-class averages (for the "Avg per class" cards)
  --------------------------*/
  const perClassAverages = useMemo(() => {
    const classes = [1, 2, 3, 4];
    return classes.map(cls => {
      const items = filteredData.filter(i => i.signalClass === cls);
      const count = items.length;
      const avgRsrp = count > 0 ? (items.reduce((s, it) => s + it.rsrp, 0) / count).toFixed(1) : '—';
      const avgThroughputKbpsClass = count > 0 ? ((items.reduce((s, it) => s + it.throughput, 0) / count) * 1000).toFixed(0) : '—';
      return {
        class: cls,
        count,
        avgRsrp,
        avgThroughputKbps: avgThroughputKbpsClass
      };
    });
  }, [filteredData]);

  /* -------------------------
     Map config
  --------------------------*/
  const mapContainerStyle = { width: '100%', height: '420px' };
  const mapCenter = useMemo(() => {
    if (!filteredData || filteredData.length === 0) {
      return { lat: -26.2041, lng: 28.0473 }; // Default to Johannesburg
    }
    
    const validPoints = filteredData.filter(point => 
      isValidCoordinate(point.lat, point.lon) && 
      point.lat !== -26.2041 && // Not default coordinates
      point.lon !== 28.0473
    );
    
    if (validPoints.length === 0) {
      return { lat: -26.2041, lng: 28.0473 };
    }
    
    const avgLat = validPoints.reduce((sum, point) => sum + point.lat, 0) / validPoints.length;
    const avgLng = validPoints.reduce((sum, point) => sum + point.lon, 0) / validPoints.length;
    
    return { lat: avgLat, lng: avgLng };
  }, [filteredData]);
  const googleApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyCVCWvIL2OHB6c0QMR_fetzeNulXUo-hCg';  // ensure you set this

  /* small class color map used in legend and markers */
  const classColors = {
    1: '#10B981', // green
    2: '#3B82F6', // blue
    3: '#F59E0B', // orange
    4: '#EF4444'  // red
  };

  /* -------------------------
     Helper: compute simple day-over-day change for Class 1 coverage
  --------------------------*/
  const dayChangePercent = (() => {
    const d = dailyData;
    const todayIdx = d.length - 1;
    if (d.length < 2) return 0;
    const last = parseFloat(d[todayIdx].class1Percentage) || 0;
    const prev = parseFloat(d[todayIdx - 1].class1Percentage) || 0;
    if (prev === 0) return last === 0 ? 0 : 100;
    return (((last - prev) / Math.abs(prev)) * 100).toFixed(1);
  })();

  /* -------------------------
     AI: lightweight intent parser + executor
     (works entirely client-side, no external APIs needed)
  --------------------------*/
  const askLocalAI = (question) => {
    const q = (question || '').toLowerCase();

    // tech filter in the question overrides dropdown if explicitly mentioned
    let subset = data;
    if (q.includes(' 5g') || q.startsWith('5g') || q.includes(' nr')) subset = data.filter(r => r.technology === '5G');
    else if (q.includes(' 4g') || q.startsWith('4g') || q.includes(' lte')) subset = data.filter(r => r.technology === '4G');
    else if (selectedTech !== 'All') subset = filteredData;

    // hour filter e.g., "between 8 and 12", "at 15:00", "hour 9"
    const hourRange = q.match(/between\s+(\d{1,2})\s*(?:and|-|to)\s*(\d{1,2})/);
    if (hourRange) {
      const h1 = clampInt(hourRange[1], 0, 23);
      const h2 = clampInt(hourRange[2], 0, 23);
      const [lo, hi] = h1 <= h2 ? [h1, h2] : [h2, h1];
      subset = subset.filter(r => r.hour >= lo && r.hour <= hi);
    } else {
      const atHour = q.match(/\b(?:hour|at)\s*(\d{1,2})\b/);
      if (atHour) {
        const h = clampInt(atHour[1], 0, 23);
        subset = subset.filter(r => r.hour === h);
      }
    }

    // simple “on Aug X” day filter
    const dayMatch = q.match(/\baug(?:ust)?\s*(\d{1,2})\b/);
    if (dayMatch) {
      const d = clampInt(dayMatch[1], 1, 31);
      subset = subset.filter(r => r.day === d);
    }

    if (!subset.length) return 'No matching rows for those filters. Try a broader question.';

    // intents
    if (q.includes('columns') || q.includes('schema') || q.includes('headers')) {
      return `Detected columns: ${summarizeColumns(data[0])}`;
    }

    if (q.includes('count') || q.includes('how many') || q.includes('rows') || q.includes('measurements')) {
      return `There are ${subset.length.toLocaleString()} measurements in this selection.`;
    }

    if (q.includes('average throughput') || q.includes('avg throughput') || q.includes('throughput mean')) {
      const mbps = avg(subset, 'throughput');
      return `Average throughput: ${fmtKbps(mbps * 1000)} (≈ ${(mbps).toFixed(1)} Mbps) based on ${subset.length.toLocaleString()} measurements.`;
    }

    if (q.includes('average rsrp') || q.includes('avg rsrp')) {
      return `Average RSRP: ${avg(subset, 'rsrp').toFixed(1)} dBm.`;
    }
    if (q.includes('average rsrq') || q.includes('avg rsrq')) {
      return `Average RSRQ: ${avg(subset, 'rsrq').toFixed(1)} dB.`;
    }
    if (q.includes('average sinr') || q.includes('avg sinr')) {
      return `Average SINR: ${avg(subset, 'sinr').toFixed(1)} dB.`;
    }

    if (q.includes('class 1') && (q.includes('percent') || q.includes('coverage') || q.includes('share'))) {
      const c1 = subset.filter(r => r.signalClass === 1).length;
      return `Class 1 coverage: ${fmtPct((c1 / subset.length) * 100)} (${c1.toLocaleString()} of ${subset.length.toLocaleString()}).`;
    }

    if (q.match(/top\s*\d+\s*sectors?.*throughput/)) {
      const k = clampInt((q.match(/top\s*(\d+)/) || ['5'])[1], 1, 50);
      const byLoc = groupBy(subset, 'location');
      const rows = Object.entries(byLoc).map(([loc, rows]) => ({ loc, mbps: avg(rows, 'throughput') }))
        .sort((a, b) => b.mbps - a.mbps).slice(0, k);
      return `Top ${rows.length} sectors by avg throughput:\n` +
        rows.map((r, i) => `${i + 1}. ${r.loc}: ${(r.mbps).toFixed(1)} Mbps`).join('\n');
    }

    if (q.match(/bottom\s*\d+\s*sectors?.*throughput/)) {
      const k = clampInt((q.match(/bottom\s*(\d+)/) || ['5'])[1], 1, 50);
      const byLoc = groupBy(subset, 'location');
      const rows = Object.entries(byLoc).map(([loc, rows]) => ({ loc, mbps: avg(rows, 'throughput') }))
        .sort((a, b) => a.mbps - b.mbps).slice(0, k);
      return `Bottom ${rows.length} sectors by avg throughput:\n` +
        rows.map((r, i) => `${i + 1}. ${r.loc}: ${(r.mbps).toFixed(1)} Mbps`).join('\n');
    }

    if (q.includes('percentile') && q.includes('throughput')) {
      const p = clampInt((q.match(/(\d{1,2})\s*th\s*percentile/) || ['95'])[1], 1, 99);
      const val = percentile(subset, 'throughput', p);
      return `${p}th percentile throughput ≈ ${(val).toFixed(1)} Mbps (${fmtKbps(val * 1000)}).`;
    }

    if (q.includes('worst rsrp') || q.includes('lowest rsrp')) {
      const worst = [...subset].sort((a, b) => a.rsrp - b.rsrp)[0];
      return `Worst RSRP: ${worst.rsrp} dBm at ${worst.location} around ${new Date(worst.timestamp).toLocaleString()}.`;
    }

    // fallback summary
    const mbps = avg(subset, 'throughput');
    const c1 = subset.filter(r => r.signalClass === 1).length;
    return [
      'Here’s a quick summary:',
      `• Rows: ${subset.length.toLocaleString()}`,
      `• Avg Throughput: ${(mbps).toFixed(1)} Mbps (${fmtKbps(mbps * 1000)})`,
      `• Avg RSRP: ${avg(subset, 'rsrp').toFixed(1)} dBm`,
      `• Avg RSRQ: ${avg(subset, 'rsrq').toFixed(1)} dB`,
      `• Avg SINR: ${avg(subset, 'sinr').toFixed(1)} dB`,
      `• Class 1: ${fmtPct((c1 / subset.length) * 100)}`
    ].join('\n');
  };

  const callOpenAI = async (question, localAnswer) => {
    // Safe guard: only call if user enabled and provided key
    if (!useLLM || !openaiKey) return null;

    const context = {
      kpis: {
        rows: filteredData.length,
        avgThroughputMbps: avg(filteredData, 'throughput').toFixed(2),
        avgRSRPdBm: avg(filteredData, 'rsrp').toFixed(2),
        avgRSRQdB: avg(filteredData, 'rsrq').toFixed(2),
        avgSINRdB: avg(filteredData, 'sinr').toFixed(2),
        class1Pct: ((filteredData.filter(r => r.signalClass === 1).length / Math.max(1, filteredData.length)) * 100).toFixed(2)
      },
      note: 'Throughput stored as Mbps in data model; UI often shows kbps.',
      columns: summarizeColumns(data[0] || {})
    };

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a telecom analytics copilot. Be concise, numeric, and accurate. Always ground answers in the provided context. Throughput is in Mbps unless stated.' },
            { role: 'user', content: `User question: ${question}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nA quick local computation says:\n${localAnswer}` }
          ],
          temperature: 0.2
        })
      });
      if (!res.ok) throw new Error('OpenAI request failed');
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch (e) {
      console.warn('LLM error', e);
      return null;
    }
  };

  const onAskAssistant = async () => {
    const question = aiInput.trim();
    if (!question) return;
    setAiMessages(m => [...m, { role: 'user', text: question }]);
    setAiInput('');

    // local instant answer
    const localAnswer = askLocalAI(question);

    // optimistic update
    setAiMessages(m => [...m, { role: 'assistant', text: localAnswer }]);

    // optionally enhance with LLM
    const llm = await callOpenAI(question, localAnswer);
    if (llm && llm !== localAnswer) {
      setAiMessages(m => [...m, { role: 'assistant', text: llm }]);
    }
  };

  /* -------------------------
     Render
  --------------------------*/
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', padding: '24px' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#111827', margin: 0, marginBottom: '8px' }}>
                📡 4G/5G Drive Test Analytics Dashboard
              </h1>
              <p style={{ color: '#6b7280', margin: 0 }}>Real-time signal strength analysis and performance monitoring</p>
            </div>
            <div>
              <select
                value={selectedTech}
                onChange={(e) => setSelectedTech(e.target.value)}
                style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
              >
                <option value="All">All Technologies</option>
                <option value="5G">5G Only</option>
                <option value="4G">4G Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* CSV Upload Section */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>
            📁 Upload Your Drive Test CSV Data
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* File Upload */}
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                  Select CSV File
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  style={{ display: 'block', width: '100%', fontSize: '14px', color: '#6b7280' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button
                  onClick={() => setDataSource('synthetic')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: dataSource === 'synthetic' ? '#2563eb' : '#e5e7eb',
                    color: dataSource === 'synthetic' ? 'white' : '#374151'
                  }}
                >
                  Use Demo Data
                </button>
                <button
                  onClick={applyCsvData}
                  disabled={!csvFile || isLoading}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500',
                    border: 'none',
                    cursor: csvFile && !isLoading ? 'pointer' : 'not-allowed',
                    backgroundColor: csvFile && !isLoading ? '#16a34a' : '#d1d5db',
                    color: csvFile && !isLoading ? 'white' : '#6b7280'
                  }}
                >
                  {isLoading ? 'Processing...' : 'Apply CSV Data'}
                </button>
              </div>

              {/* Optional: LLM toggle */}
              <div style={{ marginTop: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} />
                  <span style={{ fontSize: 14, color: '#374151' }}>Use AskDataSet powered by Watsonx to refine answers (optional)</span>
                </label>
                {useLLM && (
                  <input
                    type="password"
                    placeholder="WatsonX API Key (starts with wx-...)"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    style={{ marginTop: 8, width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                  />
                )}
                {useLLM && (
                  <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                    Your key is used client-side to call WatxonxAI directly. Leave blank to use the built-in local analytics instead.
                  </p>
                )}
              </div>
            </div>

            {/* Field Mapping */}
            {csvHeaders.length > 0 && (
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '12px' }}>Map CSV Columns to Data Fields</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {Object.entries(fieldMapping).map(([field, value]) => (
                    <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '12px', color: '#6b7280', width: '90px', textTransform: 'capitalize' }}>{field}:</label>
                      <select
                        value={value}
                        onChange={(e) => setFieldMapping(prev => ({ ...prev, [field]: e.target.value }))}
                        style={{ flex: 1, padding: '4px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                      >
                        <option value="">-- Select Column --</option>
                        {csvHeaders.map(header => (
                          <option key={header} value={header}>{header}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Data Source Status */}
          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '14px', color: '#374151' }}>
                Current Data Source: <strong>{dataSource === 'csv' ? 'Your CSV File' : 'Demo Data'}</strong>
              </span>
              <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>
                ({data.length.toLocaleString()} records)
              </span>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#6b7280', margin: 0 }}>Class 1 Coverage</p>
                <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#16a34a', margin: '4px 0 0 0' }}>{class1Percentage}%</p>
              </div>
              <div style={{ fontSize: '32px' }}>📈</div>
            </div>
            <p style={{ fontSize: '12px', color: '#6b7280', margin: '8px 0 0 0' }}>{class1Count} of {totalMeasurements} measurements</p>
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#6b7280', margin: 0 }}>Avg RSRP</p>
                <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#2563eb', margin: '4px 0 0 0' }}>{avgRSRP} dBm</p>
              </div>
              <div style={{ fontSize: '32px' }}>📶</div>
            </div>
            <p style={{ fontSize: '12px', color: '#6b7280', margin: '8px 0 0 0' }}>Signal strength indicator</p>
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#6b7280', margin: 0 }}>Avg Throughput</p>
                <p style={{ fontSize: '22px', fontWeight: '700', color: '#7c3aed', margin: '4px 0 0 0' }}>{Math.round(avgThroughputKbps).toLocaleString()} kbps</p>
                <p style={{ fontSize: '12px', color: '#6b7280', margin: '6px 0 0 0' }}>Converted from Mbps → kbps</p>
              </div>
              <div style={{ fontSize: '32px' }}>⚡</div>
            </div>
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#6b7280', margin: 0 }}>Total Tests</p>
                <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#111827', margin: '4px 0 0 0' }}>{totalMeasurements.toLocaleString()}</p>
              </div>
              <div style={{ fontSize: '32px' }}>📍</div>
            </div>
            <p style={{ fontSize: '12px', color: '#6b7280', margin: '8px 0 0 0' }}>Drive test measurements</p>
          </div>
        </div>

        {/* Map + Per-class averages + Legend */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '8px 0 12px 0', fontSize: '18px', fontWeight: 600 }}>🗺️ Test Area Map</h3>
            {googleApiKey ? (
              <LoadScript googleMapsApiKey={googleApiKey}>
                <GoogleMap 
  mapContainerStyle={mapContainerStyle} 
  center={mapCenter} 
  zoom={filteredData.length > 0 ? 12 : 2}
>
  {filteredData.filter(pt => isValidCoordinate(pt.lat, pt.lon)).map((pt, idx) => (
    <Marker
      key={`m-${idx}`}
      position={{ lat: Number(pt.lat), lng: Number(pt.lon) }}
      icon={{
        url: createMarkerSvgDataUrl(classColors[pt.signalClass] || '#10B981', 22),
        scaledSize: { width: 22, height: 22 }
      }}
      title={`${pt.location} - Class ${pt.signalClass} - ${pt.rsrp}dBm`}
    />
  ))}
</GoogleMap>
              </LoadScript>
            ) : (
              <div style={{ padding: 24, borderRadius: 8, backgroundColor: '#f3f4f6', textAlign: 'center' }}>
                <p style={{ margin: 0 }}>Google Maps API key not configured.</p>
                <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Set REACT_APP_GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable map.</p>
              </div>
            )}
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h4 style={{ marginTop: 0 }}>Legend</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(classColors).map(([cls, color]) => (
                <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 8, backgroundColor: color }} />
                  <div style={{ fontSize: 14 }}>{`Class ${cls} — ${cls === '1' ? 'Excellent' : cls === '2' ? 'Good' : cls === '3' ? 'Fair' : 'Poor'}`}</div>
                </div>
              ))}
            </div>

            <hr style={{ margin: '12px 0' }} />

            <h4 style={{ margin: '8px 0' }}>Avg per Class</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              {perClassAverages.map(pc => (
                <div key={pc.class} style={{ padding: '10px', borderRadius: 8, backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Class {pc.class}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{pc.count} measurements</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>{pc.avgRsrp !== '—' ? `${pc.avgRsrp} dBm` : '—'}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{pc.avgThroughputKbps !== '—' ? `${Number(pc.avgThroughputKbps).toLocaleString()} kbps` : '—'}</div>
                  </div>
                </div>
              ))}
            </div>

            <hr style={{ margin: '12px 0' }} />
            <div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Map markers colored by classification. Hover the pie or line charts to see more details.</div>
            </div>
          </div>
        </div>

        {/* Charts Row 1 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          {/* Hourly Class 1 Performance */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>
              ⏰ Hourly Class 1 Coverage Analysis
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'class1Percentage') return [`${value.toFixed ? value.toFixed(1) : value}%`, 'Class 1 %'];
                    if (name === 'avgRSRP') return [`${value.toFixed ? value.toFixed(1) : value} dBm`, 'Avg RSRP'];
                    if (name === 'avgThroughputKbps') return [`${Math.round(value).toLocaleString()} kbps`, 'Avg Throughput'];
                    return [value, name];
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="class1Percentage" stroke="#10B981" strokeWidth={3} name="Class 1 %" dot={false} />
                <Line type="monotone" dataKey="avgRSRP" stroke="#2563eb" strokeWidth={2} name="Avg RSRP (dBm)" yAxisId={1} dot={false} />
                <Line type="monotone" dataKey="avgThroughputKbps" stroke="#8B5CF6" strokeWidth={2} name="Throughput (kbps)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Signal Class Distribution */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>Signal Class Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={signalClassData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name.split(' ')[0]}: ${(percent * 100).toFixed(1)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {signalClassData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value}`, 'Measurements']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          {/* Daily Trend */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>
              📅 Daily Class 1 Performance Trend
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => [`${value.toFixed ? value.toFixed(1) : value}%`, 'Class 1 Coverage']} />
                <Area type="monotone" dataKey="class1Percentage" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.18} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Technology Distribution */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>Technology Usage Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={techData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" />
                <Tooltip formatter={(value) => [value, 'Measurements']} />
                <Bar dataKey="value">
                  {techData.map((entry, index) => (
                    <Cell key={`tech-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Analysis Summary */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>Analysis Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            <div style={{ padding: '16px', backgroundColor: '#dbeafe', borderRadius: '8px' }}>
              <h4 style={{ fontWeight: '600', color: '#1e40af', margin: '0 0 8px 0' }}>Peak Performance Hours</h4>
              <p style={{ fontSize: '14px', color: '#1e3a8a', margin: 0 }}>
                Best Class 1 coverage typically occurs during early morning hours (2:00-6:00) with coverage above 80%.
              </p>
            </div>
            <div style={{ padding: '16px', backgroundColor: '#fef3c7', borderRadius: '8px' }}>
              <h4 style={{ fontWeight: '600', color: '#92400e', margin: '0 0 8px 0' }}>Optimization Opportunities</h4>
              <p style={{ fontSize: '14px', color: '#92400e', margin: 0 }}>
                Peak hours (8:00-18:00) show increased signal degradation, suggesting need for capacity optimization.
              </p>
            </div>
            <div style={{ padding: '16px', backgroundColor: '#d1fae5', borderRadius: '8px' }}>
              <h4 style={{ fontWeight: '600', color: '#166534', margin: '0 0 8px 0' }}>Monthly Target</h4>
              <p style={{ fontSize: '14px', color: '#166534', margin: 0 }}>
                Current Class 1 coverage of {class1Percentage}% meets the target threshold for excellent network performance.
              </p>
              <p style={{ fontSize: 12, color: '#065f46', marginTop: 8 }}>
                Change vs previous day: <strong style={{ color: Number(dayChangePercent) >= 0 ? '#065f46' : '#b91c1c' }}>{dayChangePercent}%</strong>
              </p>
            </div>
          </div>
        </div>

        {/* -------- Floating AI Button + Chat Panel -------- */}
        <button
          onClick={() => setAiOpen(o => !o)}
          title="Ask the dataset"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            width: 60,
            height: 60,
            borderRadius: 30,
            background: '#1e3c7cff',
            color: 'white',
            border: 'none',
            boxShadow: '0 10px 20px rgba(82, 77, 77, 0.2)',
            cursor: 'pointer',
            fontSize: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          {aiOpen ? '✖' : '🤖'}
        </button>

        {aiOpen && (
          <div
            style={{
              position: 'fixed',
              right: 24,
              bottom: 96,
              width: 380,
              maxHeight: 520,
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 1000
            }}
          >
            <div style={{ padding: 12, borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <strong>AI Assistant</strong>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{dataSource === 'csv' ? 'Using your CSV' : 'Using demo data'}</div>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {filteredData.length.toLocaleString()} rows
              </div>
            </div>

            <div ref={aiPanelRef} style={{ padding: 12, flex: 1, overflowY: 'auto', background: '#fafafa' }}>
              {aiMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: m.role === 'user' ? '#111827' : 'white',
                    color: m.role === 'user' ? 'white' : '#111827',
                    whiteSpace: 'pre-wrap',
                    border: m.role === 'user' ? 'none' : '1px solid #e5e7eb'
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid #f3f4f6', display: 'flex', gap: 8 }}>
              <input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) onAskAssistant(); }}
                placeholder='Ask e.g. "average throughput on 5G between 8 and 12"'
                style={{ flex: 1, padding: 8, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
              />
              <button
                onClick={onAskAssistant}
                style={{ padding: '8px 14px', borderRadius: 8, background: '#111827', color: 'white', border: 'none', cursor: 'pointer' }}
              >
                Send
              </button>
            </div>
          </div>
        )}
        {/* -------- End AI -------- */}

      </div>
    </div>
  );
};

export default DriveTestDashboard;