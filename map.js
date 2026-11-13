// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
// Import D3 as an ESM module
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken =
  'pk.eyJ1IjoiZXJuMDEwIiwiYSI6ImNtd2ZncTU4ZzAxcXQzMHBwMDh6cnpyN3cifQ.lxjQP_GtxbJ60JMFpT8CZA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Shared style for both bike lane layers
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6,
};

// Select the SVG overlay inside the map container
const svg = d3.select('#map').select('svg');

// ---------- Global helper functions ----------

// Station ID (handout uses short_name; falls back to Number)
function stationId(station) {
  return station.short_name ?? station.Number;
}

// Convert a station's lon/lat into pixel coordinates on the map
function getCoords(station) {
  const lon = +(station.lon ?? station.Long);
  const lat = +(station.lat ?? station.Lat);
  const point = new mapboxgl.LngLat(lon, lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Minutes since midnight -> "HH:MM AM/PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Date -> minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Keep trips that started or ended within 60 minutes of the selected time
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // No filter applied, return all trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Add arrivals, departures and totalTraffic to each station
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = stationId(station);
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// ---------- Map setup ----------

// Wait for the map to finish loading before adding data
map.on('load', async () => {
  // ---- Boston bike lanes ----
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // ---- Cambridge bike lanes ----
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // ---- Bluebikes stations ----
  let rawStations = [];
  try {
    const jsonData = await d3.json(
      'https://dsc106.com/labs/lab07/data/bluebikes-stations.json',
    );
    console.log('Loaded JSON Data:', jsonData);
    rawStations = jsonData?.data?.stations ?? jsonData;
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  // ---- Bluebikes trips (parse dates as they load) ----
  let trips = [];
  try {
    trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      },
    );
    console.log('Loaded trips:', trips.length);
  } catch (error) {
    console.error('Error loading CSV:', error);
  }

  // ---- Traffic per station (all trips) ----
  const stations = computeStationTraffic(rawStations, trips);
  console.log('Stations with traffic:', stations);

  // Square root scale so circle AREA reflects traffic
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Custom tooltip element
  const tooltip = document.getElementById('tooltip');

  // Append a circle for each station, keyed by station ID
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => stationId(d))
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .on('mouseenter', (event, d) => {
      tooltip.style.display = 'block';
      tooltip.innerHTML = `<strong>${d.NAME ?? d.name ?? stationId(d)}</strong><br>
        ${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
    })
    .on('mousemove', (event) => {
      tooltip.style.left = `${event.clientX + 12}px`;
      tooltip.style.top = `${event.clientY + 12}px`;
    })
    .on('mouseleave', () => {
      tooltip.style.display = 'none';
    });

  // Reposition circles whenever the map moves/zooms
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // ---- Time slider ----
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Recompute traffic for the selected time and resize the circles
  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // Bigger circles when filtering, since fewer trips are shown
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => stationId(d))
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic));
  }

  // Update the label and the map when the slider moves
  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});