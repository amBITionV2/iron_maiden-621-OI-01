import React, { useState, useEffect, useRef, useCallback } from 'react';

// NOTE: We do not import 'leaflet' or 'leaflet.css' here because they are
// already loaded globally from the public/index.html file.

function App() {
  // --- STATE MANAGEMENT ---
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [mapCenter, setMapCenter] = useState([28.6139, 77.2090]); // Default: New Delhi
  const [searchQuery, setSearchQuery] = useState('');
  const [timeframe, setTimeframe] = useState('daily');
  const [locationData, setLocationData] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [isLeafletReady, setIsLeafletReady] = useState(!!window.L);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  // --- Reusable UI Components ---
  const Spinner = () => (
    <div className="flex justify-center items-center p-8">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-400"></div>
    </div>
  );

  const EnergyIcon = ({ type, className = "h-12 w-12" }) => {
    const icons = {
      SOLAR: ( <svg xmlns="http://www.w3.org/2000/svg" className={`${className} text-yellow-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg> ),
      WIND: ( <svg xmlns="http://www.w3.org/2000/svg" className={`${className} text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12c0-3.866 3.134-7 7-7" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12c0 3.866 3.134 7 7 7" /></svg> ),
      HYBRID: ( <svg xmlns="http://www.w3.org/2000/svg" className={`${className} text-green-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10s5 2 5 2l2-5s-2 1-4 2-3 4-3 4-1 2-1 4a8 8 0 0011.314 0z" /></svg> ),
    };
    return icons[type] || null;
  };

  // --- Country-specific Electricity Consumption Data ---
  const countryConsumptionData = {
      US: 29.3, CA: 30.5, DE: 9.5, GB: 10.3, FR: 12.0, AU: 15.9,
      IN: 3.3, CN: 8.0, JP: 13.0, BR: 6.8, ZA: 11.5, RU: 7.0,
      DEFAULT: 9.6, // Global average as a fallback
  };

  // --- LEAFLET.JS MAP INTEGRATION (CDN METHOD) ---
  useEffect(() => {
    // Check if Leaflet is loaded from the script tag in index.html
    if (!window.L) {
      const script = document.querySelector('script[src*="leaflet"]');
      const handleLoad = () => setIsLeafletReady(true);
      if (script) {
        script.addEventListener('load', handleLoad);
        // Cleanup listener on component unmount
        return () => script.removeEventListener('load', handleLoad);
      }
    }
  }, []);

  useEffect(() => {
    // Initialize map only when Leaflet is ready and the container exists
    if (isLeafletReady && mapContainerRef.current && !mapInstanceRef.current) {
      const map = window.L.map(mapContainerRef.current).setView(mapCenter, 12);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      map.on('click', (e) => setSelectedPosition([e.latlng.lat, e.latlng.lng]));
      mapInstanceRef.current = map;
    }
  }, [isLeafletReady, mapCenter]);
  
  useEffect(() => {
    // Update marker when position changes
    if (mapInstanceRef.current && selectedPosition) {
      const [lat, lng] = selectedPosition;
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = window.L.marker([lat, lng]).addTo(mapInstanceRef.current);
      }
      mapInstanceRef.current.panTo([lat, lng]);
    }
  }, [selectedPosition]);

  // --- REAL-WORLD DATA INTEGRATION ---
  const fetchRealDataForLocation = async (lat, lng) => {
    const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=shortwave_radiation_sum,wind_speed_10m_max&wind_speed_unit=mph&timezone=auto&past_days=30`;
    const overpassApiUrl = `https://overpass-api.de/api/interpreter?data=[out:json];way(around:500,${lat},${lng})["building"];out count;`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    
    const [weatherResponse, buildingResponse, geocodeResponse] = await Promise.allSettled([
        fetch(weatherApiUrl), fetch(overpassApiUrl), fetch(nominatimUrl)
    ]);

    if (weatherResponse.status !== 'fulfilled' || !weatherResponse.value.ok) throw new Error("Could not fetch climate data.");
    const weatherData = await weatherResponse.value.json();
    const getAverage = (arr) => (arr?.length > 0) ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const peakSunHours = (getAverage(weatherData.daily.shortwave_radiation_sum) / 3.6).toFixed(2);
    const avgWindSpeedMph = getAverage(weatherData.daily.wind_speed_10m_max).toFixed(2);

    let fetchedHouses = 50;
    if (buildingResponse.status === 'fulfilled' && buildingResponse.value.ok) {
        const buildingData = await buildingResponse.value.json();
        if (buildingData.elements[0]?.tags?.total) {
            fetchedHouses = Number(buildingData.elements[0].tags.total);
            setWarning('');
        }
    } else {
        setWarning("Could not fetch building count. Using default estimate.");
    }

    let countryCode = 'DEFAULT';
    if (geocodeResponse.status === 'fulfilled' && geocodeResponse.value.ok) {
        const geocodeData = await geocodeResponse.value.json();
        if (geocodeData.address?.country_code) {
             countryCode = geocodeData.address.country_code.toUpperCase();
        }
    } else {
        setWarning(prev => prev + " Could not detect country. Using global average for energy use.");
    }
    const estimatedUsage = countryConsumptionData[countryCode] || countryConsumptionData.DEFAULT;
    
    return { numberOfHouses: fetchedHouses, avgDailyUsageKWh: estimatedUsage, peakSunHours, avgWindSpeedMph, countryCode };
  };

  const analyzeMicrogridFeasibility = (data) => {
    const { peakSunHours, avgWindSpeedMph } = data;
    if (avgWindSpeedMph > 12) return { recommendation: "Wind Turbine", description: "Consistently strong winds make this location ideal for a wind turbine microgrid.", type: "WIND" };
    if (peakSunHours > 5.5) return { recommendation: "Solar Panels", description: "Excellent solar exposure suggests a solar panel array would be highly efficient.", type: "SOLAR" };
    return { recommendation: "Hybrid System (Solar + Storage)", description: "Moderate conditions suggest a hybrid approach with battery storage is the most resilient option.", type: "HYBRID" };
  };
  
  const handleAnalysis = useCallback(async (position) => {
    if (!position) return;
    const [lat, lng] = position;
    setIsLoading(true);
    setError('');
    setWarning('');
    setLocationData(null);
    setAnalysisResult(null);
    try {
      const data = await fetchRealDataForLocation(lat, lng);
      setLocationData(data);
      const result = analyzeMicrogridFeasibility(data);
      setAnalysisResult(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPosition) handleAnalysis(selectedPosition);
  }, [selectedPosition, handleAnalysis]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    setError('');
    setIsLoading(true);
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
        if (!response.ok) throw new Error("Search service failed.");
        const data = await response.json();
        if (data && data.length > 0) {
            const { lat, lon } = data[0];
            const newPos = [parseFloat(lat), parseFloat(lon)];
            if(mapInstanceRef.current){
                mapInstanceRef.current.setView(newPos, 13);
            }
            setSelectedPosition(newPos);
        } else {
            setError("Location not found.");
        }
    } catch (err) {
        setError(err.message);
    } finally {
        setIsLoading(false);
    }
  };
  
  const getTotalDemand = () => {
      if (!locationData) return 0;
      const dailyDemand = locationData.numberOfHouses * locationData.avgDailyUsageKWh;
      if (timeframe === 'weekly') return (dailyDemand * 7).toLocaleString('en-US', {maximumFractionDigits: 0});
      if (timeframe === 'monthly') return (dailyDemand * 30).toLocaleString('en-US', {maximumFractionDigits: 0});
      return dailyDemand.toLocaleString('en-US', {maximumFractionDigits: 0});
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans flex flex-col">
      <header className="bg-gray-800 p-4 shadow-lg">
        <h1 className="text-3xl font-bold text-center text-teal-400">Microgrid Feasibility Planner</h1>
      </header>
      
      <main className="flex-grow flex flex-col md:flex-row" style={{ height: "calc(100vh - 72px)" }}>
        <div className="w-full md:w-1/3 p-6 bg-gray-800 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-2">1. Select a Location</h2>
              <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                <input type="text" placeholder="e.g., Bengaluru, India" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold p-2 rounded">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
                </button>
              </form>
              <div className="flex gap-2 text-sm items-center">
                <input type="text" placeholder="Latitude" value={selectedPosition ? selectedPosition[0].toFixed(6) : ''} readOnly className="w-1/2 p-2 bg-gray-700 rounded border border-gray-600" />
                <input type="text" placeholder="Longitude" value={selectedPosition ? selectedPosition[1].toFixed(6) : ''} readOnly className="w-1/2 p-2 bg-gray-700 rounded border border-gray-600" />
              </div>
            </div>

            <div className="border-t border-gray-700 pt-6">
              <h2 className="text-xl font-semibold mb-2">2. Analysis Results</h2>
              {isLoading && <Spinner />}
              {error && <p className="text-red-400 bg-red-900/50 p-3 rounded">{error}</p>}
              {warning && !error && <p className="text-yellow-400 bg-yellow-900/50 p-3 rounded">{warning}</p>}
              
              {analysisResult && locationData && !isLoading && (
                <div className="bg-gray-700 p-4 rounded-lg shadow-inner space-y-4">
                    <div className="flex items-center gap-4">
                        <EnergyIcon type={analysisResult.type} />
                        <div>
                            <p className="text-gray-400 text-sm">Recommendation</p>
                            <p className="text-2xl font-bold text-teal-400">{analysisResult.recommendation}</p>
                        </div>
                    </div>
                  <p className="text-gray-300">{analysisResult.description}</p>
                  
                  <div className="border-t border-gray-600 pt-4">
                    <h3 className="font-semibold mb-2 text-gray-300">Data Used for Analysis:</h3>
                    <ul className="text-sm space-y-2 text-gray-400">
                      <li><span className="font-medium text-gray-200">Est. Houses (500m Radius):</span> {locationData.numberOfHouses}</li>
                      <li><span className="font-medium text-gray-200">Avg. Daily Use (Est. for {locationData.countryCode}):</span> {locationData.avgDailyUsageKWh} kWh</li>
                      <li>
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-gray-200">Total Estimated Demand:</span>
                          <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="bg-gray-600 text-xs rounded p-1">
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                          </select>
                        </div>
                        <p className="text-right text-lg font-bold text-white">{getTotalDemand()} kWh</p>
                      </li>
                      <li><span className="font-medium text-gray-200">Avg. Peak Sun Hours (30 days):</span> {locationData.peakSunHours} / day</li>
                      <li><span className="font-medium text-gray-200">Avg. Wind Speed (30 days):</span> {locationData.avgWindSpeedMph} mph</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="w-full md:w-2/3 h-64 md:h-auto" ref={mapContainerRef}>
            {!isLeafletReady && (
                <div className="w-full h-full flex items-center justify-center bg-gray-700">
                    <Spinner/>
                    <p className="text-gray-400 ml-4">Loading Map Library...</p>
                </div>
            )}
        </div>
      </main>
    </div>
  );
}

export default App;
