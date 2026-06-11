/**
 * @fileoverview EcoSense - Carbon Footprint Awareness Platform
 * Core Application Logic & Dynamic Assistant Engine
 *
 * Architecture:
 *  - Pure calculation functions (testable without DOM)
 *  - DOM rendering layer (applies results to UI)
 *  - State management via localStorage
 *  - Rule-based AI chat assistant
 *
 * @version 2.0.0
 * @license MIT
 */

'use strict';

// =============================================================================
// SECTION 1: Constants & Emission Factors
// =============================================================================

/**
 * Greenhouse Gas Protocol / EPA emission conversion factors.
 * All results are in Metric Tons of CO₂e per year unless noted.
 * @constant {Object}
 */
const FACTORS = {
    /** kg CO₂e per kWh. Annual formula: (kWh/month × 12 × factor) / (1000 × householdSize) */
    electricity: 0.38,
    /** kg CO₂e per therm. Annual formula: (therms/month × 12 × factor) / (1000 × householdSize) */
    naturalGas: 5.3,

    /** Commute emission factors in kg CO₂e per km. Annual: (km/week × 52 × factor) / 1000 */
    commute: {
        petrol:  0.18,
        diesel:  0.16,
        ev:      0.05,  // electric vehicle – grid intensity adjusted
        transit: 0.04
    },

    /** Per-flight emissions in metric tons CO₂e */
    flightsShort: 0.25,
    flightsLong:  1.20,

    /** Annual diet-based food footprint in metric tons CO₂e per year */
    diet: {
        heavyMeat:  2.9,
        average:    2.1,
        vegetarian: 1.4,
        vegan:      1.0
    },

    /** Annual shopping & consumption footprint in metric tons CO₂e per year */
    shopping: {
        high:    2.5,
        average: 1.5,
        low:     0.7
    },

    /** Recycling impacts: negative value = reduction, positive = addition */
    recycleOffset:   -0.2,
    noRecycleCost:    0.2
};

/**
 * National average carbon footprint baseline (US/Global context).
 * Used for the progress bar comparison.
 * @constant {number}
 */
const NATIONAL_AVERAGE = 16.0;

/**
 * Minimum waste/consumption footprint floor (tons CO₂e/yr).
 * Prevents negative consumption values even with full recycling offset.
 * @constant {number}
 */
const MIN_WASTE_FLOOR = 0.2;

/**
 * Minimum possible net emissions after action deductions (tons CO₂e/yr).
 * Prevents a zero or negative display value.
 * @constant {number}
 */
const MIN_NET_EMISSIONS = 0.1;

/**
 * Equivalency conversion factors for making footprint values tangible.
 * @constant {Object}
 */
const EQUIVALENCY_FACTORS = {
    /** Tons CO₂e per transatlantic flight (London–NY return average) */
    tonsPerFlight: 1.6,
    /** Smartphone charges per metric ton of CO₂e */
    chargesPerTon: 121000,
    /** Trees needed to offset 1 ton CO₂e per year (assumes 22 kg absorbed/tree/yr) */
    treesPerTon: 45
};

/**
 * Fallback emission values for non-specialist personas (baseline behavior).
 * @constant {Object}
 */
const DEFAULTS = {
    /** Default weekly commute km assumed for non-commuter personas */
    commuteKmWeek: 60,
    /** Default monthly electricity kWh for non-dweller personas */
    electricityKwh: 280
};

/**
 * List of available mitigation actions users can pledge.
 * Each action deducts `impact` tons CO₂e/yr from the net footprint.
 * @constant {Array<{id: string, title: string, desc: string, category: string, impact: number}>}
 */
const MITIGATION_ACTIONS = [
    {
        id: 'action_led',
        title: 'Switch to LED Bulbs',
        desc: 'Replace standard incandescent bulbs with energy-efficient LEDs.',
        category: 'energy',
        impact: 0.30
    },
    {
        id: 'action_bike',
        title: 'Bike or Walk Short Trips',
        desc: 'Swap driving for cycling or walking 2 days a week.',
        category: 'transport',
        impact: 0.75
    },
    {
        id: 'action_meatless',
        title: 'Adopt "Meatless Mondays"',
        desc: 'Go meat-free for one day every week.',
        category: 'food',
        impact: 0.35
    },
    {
        id: 'action_thermostat',
        title: 'Install a Smart Thermostat',
        desc: 'Optimize heating and cooling schedules at home.',
        category: 'energy',
        impact: 0.45
    },
    {
        id: 'action_cold_wash',
        title: 'Wash Laundry in Cold Water',
        desc: 'Save heating energy on up to 4 loads of laundry a week.',
        category: 'energy',
        impact: 0.12
    },
    {
        id: 'action_compost',
        title: 'Compost Organic Waste',
        desc: 'Reduce methane emissions from food waste in landfills.',
        category: 'waste',
        impact: 0.18
    },
    {
        id: 'action_reusable',
        title: 'Go Zero Single-Use Plastics',
        desc: 'Commit to reusable bottles, bags, and zero-packaging shopping.',
        category: 'waste',
        impact: 0.15
    },
    {
        id: 'action_solar',
        title: 'Pledge Green Energy Supply',
        desc: 'Switch your home energy plan to 100% renewable sources.',
        category: 'energy',
        impact: 1.20
    }
];

// =============================================================================
// SECTION 2: Application State
// =============================================================================

/**
 * @typedef {Object} AppState
 * @property {string|null} currentPersona - Active persona: 'commuter'|'consumer'|'dweller'|null
 * @property {Object} inputs - All calculator input values
 * @property {string[]} completedActions - Array of pledged action IDs
 * @property {Array<{sender: string, text: string}>} chatHistory - Recent chat messages
 * @property {number} lastCalculatedScore - Last computed net footprint (tons CO₂e/yr)
 */

/** @type {AppState} */
let state = {
    currentPersona: null,
    inputs: {
        // Commuter
        commuteDist: 150,
        vehicleType: 'petrol',
        // Consumer
        dietType: 'average',
        shoppingFreq: 'average',
        // Dweller
        electricity: 350,
        householdSize: 2,
        // General
        gas: 30,
        flights: 2,
        flightsLong: 1,
        recycle: 'yes'
    },
    completedActions: [],
    chatHistory: [],
    lastCalculatedScore: 0
};

/**
 * Valid schema for state validation on load.
 * Protects against corrupted or prototype-polluted localStorage data.
 */
const STATE_SCHEMA = {
    currentPersona: { type: 'nullable-string', allowed: [null, 'commuter', 'consumer', 'dweller'] },
    inputs: {
        commuteDist:  { type: 'number', min: 0, max: 800 },
        vehicleType:  { type: 'string', allowed: ['petrol', 'diesel', 'ev', 'transit'] },
        dietType:     { type: 'string', allowed: ['heavyMeat', 'average', 'vegetarian', 'vegan'] },
        shoppingFreq: { type: 'string', allowed: ['high', 'average', 'low'] },
        electricity:  { type: 'number', min: 0, max: 1200 },
        householdSize:{ type: 'number', min: 1, max: 6 },
        gas:          { type: 'number', min: 0, max: 150 },
        flights:      { type: 'number', min: 0, max: 20 },
        flightsLong:  { type: 'number', min: 0, max: 10 },
        recycle:      { type: 'string', allowed: ['yes', 'no'] }
    },
    completedActions: { type: 'array' },
    chatHistory: { type: 'array' }
};

// =============================================================================
// SECTION 3: DOM Element Cache (Browser-only)
// =============================================================================

// Guard: DOM APIs are not available in Node.js test environment.
// All DOM-dependent code is wrapped so pure functions can be imported freely.
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

const onboardingModal      = IS_BROWSER ? document.getElementById('onboardingModal') : null;
const changePersonaBtn     = IS_BROWSER ? document.getElementById('changePersonaBtn') : null;
const personaBadgeText     = IS_BROWSER ? document.getElementById('personaBadgeText') : null;
const currentPersonaBadge  = IS_BROWSER ? document.getElementById('currentPersonaBadge') : null;
const dynamicPersonaFields = IS_BROWSER ? document.getElementById('dynamicPersonaFields') : null;

const tabBtns     = IS_BROWSER ? document.querySelectorAll('.tab-btn') : [];
const tabContents = IS_BROWSER ? document.querySelectorAll('.tab-content') : [];

// General inputs
const inputGas        = IS_BROWSER ? document.getElementById('inputGas') : null;
const valGas          = IS_BROWSER ? document.getElementById('valGas') : null;
const inputFlights    = IS_BROWSER ? document.getElementById('inputFlights') : null;
const valFlights      = IS_BROWSER ? document.getElementById('valFlights') : null;
const inputLongFlights= IS_BROWSER ? document.getElementById('inputLongFlights') : null;
const valLongFlights  = IS_BROWSER ? document.getElementById('valLongFlights') : null;
const recycleYes      = IS_BROWSER ? document.getElementById('recycleYes') : null;
const recycleNo       = IS_BROWSER ? document.getElementById('recycleNo') : null;

// Dashboard metrics
const totalFootprintVal    = IS_BROWSER ? document.getElementById('totalFootprintVal') : null;
const footprintProgress    = IS_BROWSER ? document.getElementById('footprintProgress') : null;
const footprintProgressBar = IS_BROWSER ? document.getElementById('footprintProgressBar') : null;
const comparisonPct        = IS_BROWSER ? document.getElementById('comparisonPct') : null;

// Donut chart
const segmentTransport = IS_BROWSER ? document.getElementById('segmentTransport') : null;
const segmentEnergy    = IS_BROWSER ? document.getElementById('segmentEnergy') : null;
const segmentFood      = IS_BROWSER ? document.getElementById('segmentFood') : null;
const segmentWaste     = IS_BROWSER ? document.getElementById('segmentWaste') : null;
const valTransport     = IS_BROWSER ? document.getElementById('valTransport') : null;
const valEnergy        = IS_BROWSER ? document.getElementById('valEnergy') : null;
const valFood          = IS_BROWSER ? document.getElementById('valFood') : null;
const valWaste         = IS_BROWSER ? document.getElementById('valWaste') : null;

// Equivalency displays
const eqFlights = IS_BROWSER ? document.getElementById('eqFlights') : null;
const eqPhones  = IS_BROWSER ? document.getElementById('eqPhones') : null;
const eqTrees   = IS_BROWSER ? document.getElementById('eqTrees') : null;

// Action tracker
const actionListContainer = IS_BROWSER ? document.getElementById('actionListContainer') : null;
const savingsBanner       = IS_BROWSER ? document.getElementById('savingsBanner') : null;
const totalSavingsVal     = IS_BROWSER ? document.getElementById('totalSavingsVal') : null;

// Chat
const chatMessages = IS_BROWSER ? document.getElementById('chatMessages') : null;
const chatForm     = IS_BROWSER ? document.getElementById('chatForm') : null;
const chatInput    = IS_BROWSER ? document.getElementById('chatInput') : null;
const sugAnalyze   = IS_BROWSER ? document.getElementById('sugAnalyze') : null;
const sugReduce    = IS_BROWSER ? document.getElementById('sugReduce') : null;
const sugOffset    = IS_BROWSER ? document.getElementById('sugOffset') : null;

// =============================================================================
// SECTION 4: Security Utilities (isomorphic – works in browser & Node.js)
// =============================================================================

/**
 * Sanitizes a string to prevent XSS injection when inserting user-supplied
 * content into the DOM. Escapes HTML special characters.
 * Works in both browser (via DOM) and Node.js (via regex fallback).
 *
 * @param {string} str - Potentially unsafe user-supplied string
 * @returns {string} HTML-entity-escaped string safe for innerHTML insertion
 *
 * @example
 * sanitizeHTML('<script>alert(1)</script>') // → '&lt;script&gt;alert(1)&lt;/script&gt;'
 */
function sanitizeHTML(str) {
    if (IS_BROWSER) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }
    // Node.js fallback: manual HTML entity escaping
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// =============================================================================
// SECTION 5: State Management
// =============================================================================

/**
 * Persists current application state to localStorage.
 * Called after any state mutation.
 */
function saveState() {
    localStorage.setItem('ecosense_state', JSON.stringify(state));
}

/**
 * Loads and validates application state from localStorage.
 * Falls back to default state if data is missing, corrupt, or fails validation.
 *
 * @returns {void}
 */
function loadState() {
    const saved = localStorage.getItem('ecosense_state');
    if (!saved) return;

    let parsed;
    try {
        parsed = JSON.parse(saved);
    } catch (e) {
        console.warn('[EcoSense] Failed to parse saved state; using defaults.', e);
        return;
    }

    // Validate persona
    if (!STATE_SCHEMA.currentPersona.allowed.includes(parsed.currentPersona)) {
        console.warn('[EcoSense] Invalid persona in saved state; resetting to null.');
        parsed.currentPersona = null;
    }

    // Validate inputs object
    if (parsed.inputs && typeof parsed.inputs === 'object') {
        for (const [key, schema] of Object.entries(STATE_SCHEMA.inputs)) {
            const val = parsed.inputs[key];
            if (schema.type === 'number') {
                if (typeof val !== 'number' || isNaN(val) || val < schema.min || val > schema.max) {
                    console.warn(`[EcoSense] Invalid input "${key}" = ${val}; using default.`);
                    parsed.inputs[key] = state.inputs[key]; // fallback to default
                }
            } else if (schema.type === 'string' && schema.allowed) {
                if (!schema.allowed.includes(val)) {
                    console.warn(`[EcoSense] Invalid input "${key}" = "${val}"; using default.`);
                    parsed.inputs[key] = state.inputs[key];
                }
            }
        }
    } else {
        parsed.inputs = { ...state.inputs };
    }

    // Validate arrays
    if (!Array.isArray(parsed.completedActions)) parsed.completedActions = [];
    if (!Array.isArray(parsed.chatHistory)) parsed.chatHistory = [];

    // Guard: only allow known action IDs in completedActions
    const validActionIds = MITIGATION_ACTIONS.map(a => a.id);
    parsed.completedActions = parsed.completedActions.filter(id => validActionIds.includes(id));

    state = { ...state, ...parsed };
}

// =============================================================================
// SECTION 6: Core Footprint Calculation (Pure Functions – Testable)
// =============================================================================

/**
 * Calculates all emission category totals for a given persona and inputs.
 * This is a PURE function – no DOM access, fully unit-testable.
 *
 * @param {string|null} persona - 'commuter', 'consumer', 'dweller', or null
 * @param {Object} inputs - The calculator input values (matches state.inputs shape)
 * @returns {{transport: number, energy: number, food: number, waste: number}}
 *   Emissions breakdown by category in metric tons CO₂e per year
 */
function calculateFootprint(persona, inputs) {
    // 1. Transport Emissions
    let transport = 0;
    if (persona === 'commuter') {
        const factor = FACTORS.commute[inputs.vehicleType] || FACTORS.commute.petrol;
        transport += (inputs.commuteDist * 52 * factor) / 1000;
    } else {
        // Default baseline commute for non-commuter personas
        transport += (DEFAULTS.commuteKmWeek * 52 * FACTORS.commute.petrol) / 1000;
    }
    // Short + long-haul flights
    transport += (inputs.flights * FACTORS.flightsShort) + (inputs.flightsLong * FACTORS.flightsLong);

    // 2. Home Energy Emissions
    let energy = 0;
    const householdFactor = (persona === 'dweller') ? (inputs.householdSize || 1) : 1;

    if (persona === 'dweller') {
        const electricAnnual = (inputs.electricity * 12 * FACTORS.electricity) / 1000;
        energy += electricAnnual / householdFactor;
    } else {
        energy += (DEFAULTS.electricityKwh * 12 * FACTORS.electricity) / 1000;
    }
    // Gas heating (always applies, scaled by household size for dwellers)
    energy += ((inputs.gas * 12 * FACTORS.naturalGas) / 1000) / householdFactor;

    // 3. Food / Diet Emissions
    let food = 0;
    if (persona === 'consumer') {
        food += FACTORS.diet[inputs.dietType] || FACTORS.diet.average;
    } else {
        food += FACTORS.diet.average;
    }

    // 4. Consumption & Waste Emissions
    let waste = 0;
    if (persona === 'consumer') {
        waste += FACTORS.shopping[inputs.shoppingFreq] || FACTORS.shopping.average;
    } else {
        waste += FACTORS.shopping.average;
    }
    waste += (inputs.recycle === 'yes') ? FACTORS.recycleOffset : FACTORS.noRecycleCost;
    waste = Math.max(MIN_WASTE_FLOOR, waste); // floor prevents near-zero/negative values

    return { transport, energy, food, waste };
}

/**
 * Rounds four category percentage values to integers that sum exactly to 100.
 * Uses the "largest remainder method" to distribute rounding errors fairly.
 *
 * @param {number} transport - Raw transport proportion (0–100)
 * @param {number} energy - Raw energy proportion (0–100)
 * @param {number} food - Raw food proportion (0–100)
 * @param {number} waste - Raw waste proportion (0–100)
 * @returns {{transport: number, energy: number, food: number, waste: number}}
 *   Integer percentages summing to exactly 100
 */
function roundToHundred(transport, energy, food, waste) {
    const values = [
        { key: 'transport', raw: transport },
        { key: 'energy',    raw: energy },
        { key: 'food',      raw: food },
        { key: 'waste',     raw: waste }
    ];

    let sum = 0;
    values.forEach(v => {
        v.floor = Math.floor(v.raw);
        v.remainder = v.raw - v.floor;
        sum += v.floor;
    });

    // Distribute the remaining points to the categories with largest remainders
    let remaining = 100 - sum;
    values
        .slice() // avoid mutating original
        .sort((a, b) => b.remainder - a.remainder)
        .forEach(v => {
            if (remaining > 0) {
                v.floor += 1;
                remaining--;
            }
        });

    const result = {};
    values.forEach(v => { result[v.key] = v.floor; });
    return result;
}

// =============================================================================
// SECTION 7: DOM Update Layer
// =============================================================================

/**
 * Orchestrates a full recalculation pass and updates all UI elements.
 * Called whenever any calculator input changes.
 *
 * @returns {void}
 */
function updateCalculations() {
    const { transport, energy, food, waste } = calculateFootprint(state.currentPersona, state.inputs);

    // Sum action deductions
    let totalReductions = 0;
    state.completedActions.forEach(actionId => {
        const actionObj = MITIGATION_ACTIONS.find(a => a.id === actionId);
        if (actionObj) totalReductions += actionObj.impact;
    });

    const baseEmissions = transport + energy + food + waste;
    const netEmissions  = Math.max(MIN_NET_EMISSIONS, baseEmissions - totalReductions);

    // --- Score ---
    totalFootprintVal.textContent = netEmissions.toFixed(1);

    // --- Progress Bar ---
    const compRatio = (netEmissions / NATIONAL_AVERAGE) * 100;
    const clampedRatio = Math.min(100, compRatio);
    footprintProgress.style.width = `${clampedRatio}%`;

    // Update ARIA valuenow for screen readers
    footprintProgressBar.setAttribute('aria-valuenow', Math.round(clampedRatio));
    footprintProgressBar.setAttribute('aria-valuetext',
        `${Math.round(clampedRatio)}% of national average (${netEmissions.toFixed(1)} tons)`);

    if (netEmissions < 8.0) {
        footprintProgress.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
    } else if (netEmissions < 15.0) {
        footprintProgress.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    } else {
        footprintProgress.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
    }

    if (netEmissions < NATIONAL_AVERAGE) {
        const diff = ((NATIONAL_AVERAGE - netEmissions) / NATIONAL_AVERAGE * 100).toFixed(0);
        comparisonPct.textContent = `${diff}% Below Average`;
        comparisonPct.style.color = 'var(--color-primary)';
    } else {
        const diff = ((netEmissions - NATIONAL_AVERAGE) / NATIONAL_AVERAGE * 100).toFixed(0);
        comparisonPct.textContent = `${diff}% Above Average`;
        comparisonPct.style.color = '#ef4444';
    }

    // --- Donut Chart ---
    renderDonutChart({ transport, energy, food, waste });

    // --- Equivalencies ---
    eqFlights.textContent = (netEmissions / EQUIVALENCY_FACTORS.tonsPerFlight).toFixed(1);
    eqPhones.textContent  = Math.round(netEmissions * EQUIVALENCY_FACTORS.chargesPerTon).toLocaleString();
    eqTrees.textContent   = Math.round(netEmissions * EQUIVALENCY_FACTORS.treesPerTon);

    // --- Savings Banner ---
    if (totalReductions > 0) {
        savingsBanner.classList.remove('hidden');
        totalSavingsVal.textContent = totalReductions.toFixed(2);
    } else {
        savingsBanner.classList.add('hidden');
    }

    state.lastCalculatedScore = netEmissions;
    saveState();
}

/**
 * Renders the SVG donut chart segment positions based on emission category totals.
 * Uses the largest-remainder rounding method to ensure segments sum to exactly 100%.
 *
 * @param {{transport: number, energy: number, food: number, waste: number}} categories
 *   Raw emission values per category (tons CO₂e/yr)
 * @returns {void}
 */
function renderDonutChart(categories) {
    const total = Object.values(categories).reduce((a, b) => a + b, 0);
    if (total <= 0) return;

    const rawT = (categories.transport / total) * 100;
    const rawE = (categories.energy    / total) * 100;
    const rawF = (categories.food      / total) * 100;
    const rawW = (categories.waste     / total) * 100;

    // Apply largest-remainder rounding for an exact sum of 100
    const pct = roundToHundred(rawT, rawE, rawF, rawW);

    // Update legend text
    valTransport.textContent = `${pct.transport}%`;
    valEnergy.textContent    = `${pct.energy}%`;
    valFood.textContent      = `${pct.food}%`;
    valWaste.textContent     = `${pct.waste}%`;

    // Update SVG segment dasharray offsets (circumference = 100 with r=15.915)
    let accum = 0;
    segmentTransport.style.strokeDasharray  = `${pct.transport} 100`;
    segmentTransport.style.strokeDashoffset = '25';
    accum += pct.transport;

    segmentEnergy.style.strokeDasharray  = `${pct.energy} 100`;
    segmentEnergy.style.strokeDashoffset = `${25 - accum}`;
    accum += pct.energy;

    segmentFood.style.strokeDasharray  = `${pct.food} 100`;
    segmentFood.style.strokeDashoffset = `${25 - accum}`;
    accum += pct.food;

    segmentWaste.style.strokeDasharray  = `${pct.waste} 100`;
    segmentWaste.style.strokeDashoffset = `${25 - accum}`;
}

// =============================================================================
// SECTION 8: Persona Management
// =============================================================================

/**
 * Selects a lifestyle persona, updates state, applies persona UI, and
 * sends a customized welcome message to the chat assistant.
 *
 * @param {'commuter'|'consumer'|'dweller'} persona - The selected persona key
 * @returns {void}
 */
function selectPersona(persona) {
    state.currentPersona = persona;
    saveState();

    applyPersonaUI();
    onboardingModal.classList.add('hidden');
    updateCalculations();

    // Persona-specific welcome message
    const welcomeMessages = {
        commuter: `Welcome, Commuter! I've calibrated your model to focus on transportation footprints. Your dashboard will highlight transit and vehicle efficiency. Adjust the travel sliders in the calculator to see the impact!`,
        consumer: `Hello, Conscious Consumer! Your calculations are now calibrated to focus on product life-cycles, diet choices, and household recycling. Let's optimize your consumption footprint.`,
        dweller:  `Greetings, Urban Dweller! We have customized your analysis around home heating, household capacity, and appliance electricity. Adjust your utility inputs below to explore reductions.`
    };

    chatMessages.innerHTML = '';
    addChatMessage('assistant', welcomeMessages[persona] || welcomeMessages.dweller);
}

/**
 * Updates the header persona badge color and text, then re-renders persona fields.
 *
 * @returns {void}
 */
function applyPersonaUI() {
    const labels = { commuter: 'Daily Commuter', consumer: 'Conscious Consumer', dweller: 'Eco Urban Dweller' };
    const colors = { commuter: 'var(--color-transport)', consumer: 'var(--color-waste)', dweller: 'var(--color-energy)' };

    personaBadgeText.textContent = labels[state.currentPersona] || 'Select Persona';

    const dot = currentPersonaBadge.querySelector('.badge-dot');
    const color = colors[state.currentPersona] || 'var(--color-primary)';
    dot.style.backgroundColor = color;
    dot.style.boxShadow = `0 0 8px ${color}`;

    renderPersonaFields();
}

/**
 * Dynamically generates persona-specific calculator input fields and binds
 * their event listeners. Rebuilds the #dynamicPersonaFields container.
 *
 * @returns {void}
 */
function renderPersonaFields() {
    dynamicPersonaFields.innerHTML = '';

    if (state.currentPersona === 'commuter') {
        dynamicPersonaFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="inputCommute">Weekly Driving Distance (km)</label>
                    <div class="slider-container">
                        <input type="range" id="inputCommute" min="0" max="800"
                               value="${state.inputs.commuteDist}" class="input-slider"
                               aria-label="Weekly driving distance in kilometres"
                               aria-valuemin="0" aria-valuemax="800" aria-valuenow="${state.inputs.commuteDist}">
                        <span class="slider-value" id="valCommute" aria-hidden="true">${state.inputs.commuteDist}</span>
                    </div>
                </div>
                <div class="form-group" role="group" aria-labelledby="vehicleLegend">
                    <span id="vehicleLegend" class="form-group-label">Vehicle / Fuel Type</span>
                    <div class="radio-group">
                        <input type="radio" id="vehiclePetrol" name="vehicleOption" value="petrol" ${state.inputs.vehicleType === 'petrol' ? 'checked' : ''}>
                        <label for="vehiclePetrol">Petrol</label>
                        <input type="radio" id="vehicleDiesel" name="vehicleOption" value="diesel" ${state.inputs.vehicleType === 'diesel' ? 'checked' : ''}>
                        <label for="vehicleDiesel">Diesel</label>
                        <input type="radio" id="vehicleEV" name="vehicleOption" value="ev" ${state.inputs.vehicleType === 'ev' ? 'checked' : ''}>
                        <label for="vehicleEV">Electric (EV)</label>
                        <input type="radio" id="vehicleTransit" name="vehicleOption" value="transit" ${state.inputs.vehicleType === 'transit' ? 'checked' : ''}>
                        <label for="vehicleTransit">Public Transit</label>
                    </div>
                </div>
            </div>
        `;

        const inputCommute = document.getElementById('inputCommute');
        const valCommute   = document.getElementById('valCommute');
        inputCommute.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            valCommute.textContent = val;
            inputCommute.setAttribute('aria-valuenow', val);
            state.inputs.commuteDist = val;
            saveState();
            updateCalculations();
        });

        document.getElementsByName('vehicleOption').forEach(opt => {
            opt.addEventListener('change', (e) => {
                state.inputs.vehicleType = e.target.value;
                saveState();
                updateCalculations();
            });
        });

    } else if (state.currentPersona === 'consumer') {
        dynamicPersonaFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group" role="group" aria-labelledby="dietLegend">
                    <span id="dietLegend" class="form-group-label">Diet Type</span>
                    <div class="radio-group">
                        <input type="radio" id="dietMeat" name="dietOption" value="heavyMeat" ${state.inputs.dietType === 'heavyMeat' ? 'checked' : ''}>
                        <label for="dietMeat">Meat Heavy</label>
                        <input type="radio" id="dietAvg" name="dietOption" value="average" ${state.inputs.dietType === 'average' ? 'checked' : ''}>
                        <label for="dietAvg">Balanced</label>
                        <input type="radio" id="dietVeg" name="dietOption" value="vegetarian" ${state.inputs.dietType === 'vegetarian' ? 'checked' : ''}>
                        <label for="dietVeg">Vegetarian</label>
                        <input type="radio" id="dietVegan" name="dietOption" value="vegan" ${state.inputs.dietType === 'vegan' ? 'checked' : ''}>
                        <label for="dietVegan">Vegan</label>
                    </div>
                </div>
                <div class="form-group" role="group" aria-labelledby="shopLegend">
                    <span id="shopLegend" class="form-group-label">Shopping &amp; Consumption Rate</span>
                    <div class="radio-group">
                        <input type="radio" id="shopHigh" name="shopOption" value="high" ${state.inputs.shoppingFreq === 'high' ? 'checked' : ''}>
                        <label for="shopHigh">Frequent</label>
                        <input type="radio" id="shopAvg" name="shopOption" value="average" ${state.inputs.shoppingFreq === 'average' ? 'checked' : ''}>
                        <label for="shopAvg">Average</label>
                        <input type="radio" id="shopLow" name="shopOption" value="low" ${state.inputs.shoppingFreq === 'low' ? 'checked' : ''}>
                        <label for="shopLow">Minimalist</label>
                    </div>
                </div>
            </div>
        `;

        document.getElementsByName('dietOption').forEach(opt => {
            opt.addEventListener('change', (e) => {
                state.inputs.dietType = e.target.value;
                saveState();
                updateCalculations();
            });
        });

        document.getElementsByName('shopOption').forEach(opt => {
            opt.addEventListener('change', (e) => {
                state.inputs.shoppingFreq = e.target.value;
                saveState();
                updateCalculations();
            });
        });

    } else if (state.currentPersona === 'dweller') {
        dynamicPersonaFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="inputElectricity">Electricity Usage (kWh/month)</label>
                    <div class="slider-container">
                        <input type="range" id="inputElectricity" min="0" max="1200"
                               value="${state.inputs.electricity}" class="input-slider"
                               aria-label="Monthly electricity usage in kilowatt hours"
                               aria-valuemin="0" aria-valuemax="1200" aria-valuenow="${state.inputs.electricity}">
                        <span class="slider-value" id="valElectricity" aria-hidden="true">${state.inputs.electricity}</span>
                    </div>
                </div>
                <div class="form-group">
                    <label for="inputHousehold">Household Size</label>
                    <div class="slider-container">
                        <input type="range" id="inputHousehold" min="1" max="6"
                               value="${state.inputs.householdSize}" class="input-slider"
                               aria-label="Number of people in household"
                               aria-valuemin="1" aria-valuemax="6" aria-valuenow="${state.inputs.householdSize}">
                        <span class="slider-value" id="valHousehold" aria-hidden="true">${state.inputs.householdSize}</span>
                    </div>
                </div>
            </div>
        `;

        const inputElectricity = document.getElementById('inputElectricity');
        const valElectricity   = document.getElementById('valElectricity');
        inputElectricity.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            valElectricity.textContent = val;
            inputElectricity.setAttribute('aria-valuenow', val);
            state.inputs.electricity = val;
            saveState();
            updateCalculations();
        });

        const inputHousehold = document.getElementById('inputHousehold');
        const valHousehold   = document.getElementById('valHousehold');
        inputHousehold.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            valHousehold.textContent = val;
            inputHousehold.setAttribute('aria-valuenow', val);
            state.inputs.householdSize = val;
            saveState();
            updateCalculations();
        });
    }
}

// =============================================================================
// SECTION 9: General Calculator Listeners
// =============================================================================

/**
 * Attaches event listeners to the general (non-persona) calculator inputs
 * and syncs slider position from persisted state on page load.
 *
 * @returns {void}
 */
function setupGeneralListeners() {
    inputGas.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        valGas.textContent = val;
        inputGas.setAttribute('aria-valuenow', val);
        state.inputs.gas = val;
        saveState();
        updateCalculations();
    });

    inputFlights.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        valFlights.textContent = val;
        inputFlights.setAttribute('aria-valuenow', val);
        state.inputs.flights = val;
        saveState();
        updateCalculations();
    });

    inputLongFlights.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        valLongFlights.textContent = val;
        inputLongFlights.setAttribute('aria-valuenow', val);
        state.inputs.flightsLong = val;
        saveState();
        updateCalculations();
    });

    document.getElementsByName('recycleOption').forEach(opt => {
        opt.addEventListener('change', (e) => {
            state.inputs.recycle = e.target.value;
            saveState();
            updateCalculations();
        });
    });

    // Sync slider UI from loaded state
    inputGas.value         = state.inputs.gas;
    valGas.textContent     = state.inputs.gas;
    inputFlights.value     = state.inputs.flights;
    valFlights.textContent = state.inputs.flights;
    inputLongFlights.value = state.inputs.flightsLong;
    valLongFlights.textContent = state.inputs.flightsLong;

    inputGas.setAttribute('aria-valuenow', state.inputs.gas);
    inputFlights.setAttribute('aria-valuenow', state.inputs.flights);
    inputLongFlights.setAttribute('aria-valuenow', state.inputs.flightsLong);

    if (state.inputs.recycle === 'yes') {
        recycleYes.checked = true;
    } else {
        recycleNo.checked = true;
    }
}

// =============================================================================
// SECTION 10: Mitigation Action Tracker
// =============================================================================

/**
 * Fully renders all mitigation action items into the action list container.
 * Replaces the entire list – called once on init and on full state resets.
 *
 * @returns {void}
 */
function renderActionList() {
    actionListContainer.innerHTML = '';

    MITIGATION_ACTIONS.forEach(action => {
        const isChecked = state.completedActions.includes(action.id);

        const item = document.createElement('div');
        item.className = `action-item ${isChecked ? 'checked' : ''}`;
        item.dataset.id = action.id;
        item.setAttribute('role', 'listitem');

        item.innerHTML = `
            <div class="action-checkbox-wrapper">
                <input type="checkbox" class="action-checkbox"
                       id="check_${sanitizeHTML(action.id)}"
                       aria-label="${sanitizeHTML(action.title)} – saves ${action.impact} tons CO₂e per year"
                       ${isChecked ? 'checked' : ''}>
                <span class="checkbox-custom" aria-hidden="true"></span>
            </div>
            <div class="action-details">
                <label class="action-title" for="check_${sanitizeHTML(action.id)}">${sanitizeHTML(action.title)}</label>
                <span class="action-desc">${sanitizeHTML(action.desc)}</span>
            </div>
            <span class="action-impact" aria-label="Impact: minus ${action.impact} tons per year">-${action.impact}t</span>
        `;

        // Item click toggles (prevents double-fire on direct checkbox click)
        item.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox' || e.target.tagName === 'LABEL') return;
            toggleAction(action.id);
        });

        item.querySelector('.action-checkbox').addEventListener('change', () => {
            toggleAction(action.id);
        });

        actionListContainer.appendChild(item);
    });
}

/**
 * Toggles a mitigation action on/off (adds/removes from completedActions).
 * Updates the specific DOM item in-place instead of full list re-render
 * for better performance.
 *
 * @param {string} actionId - The unique ID of the mitigation action to toggle
 * @returns {void}
 */
function toggleAction(actionId) {
    const idx = state.completedActions.indexOf(actionId);
    if (idx > -1) {
        state.completedActions.splice(idx, 1);
    } else {
        state.completedActions.push(actionId);
    }

    // Efficient in-place DOM update: only update the toggled item's state
    const item = actionListContainer.querySelector(`[data-id="${CSS.escape(actionId)}"]`);
    if (item) {
        const isNowChecked = state.completedActions.includes(actionId);
        item.classList.toggle('checked', isNowChecked);
        const cb = item.querySelector('.action-checkbox');
        if (cb) cb.checked = isNowChecked;
    }

    saveState();
    updateCalculations();
}

// =============================================================================
// SECTION 11: EcoGuide AI Chat Assistant
// =============================================================================

/**
 * Reads current dashboard category percentages from the DOM.
 * Centralizes the repeated pattern of parsing category %-values.
 *
 * @returns {{transport: number, energy: number, food: number, waste: number}}
 *   Current percentage breakdown of the carbon footprint by category
 */
function getCategoryPercentages() {
    return {
        transport: parseFloat(valTransport.textContent) || 0,
        energy:    parseFloat(valEnergy.textContent)    || 0,
        food:      parseFloat(valFood.textContent)      || 0,
        waste:     parseFloat(valWaste.textContent)     || 0
    };
}

/**
 * Returns the category key with the highest current percentage.
 *
 * @returns {'transport'|'energy'|'food'|'waste'} The largest emission category name
 */
function getTopCategory() {
    const pct = getCategoryPercentages();
    return Object.entries(pct).reduce(
        (top, [key, val]) => val > top.val ? { key, val } : top,
        { key: 'transport', val: -Infinity }
    ).key;
}

/**
 * Handles a user-typed chat message: sanitizes input, adds user bubble,
 * clears input field, and schedules an AI reply.
 *
 * @returns {void}
 */
function handleUserMessage() {
    const rawQuery = chatInput.value.trim();
    if (!rawQuery) return;

    addChatMessage('user', rawQuery); // sanitized inside addChatMessage
    chatInput.value = '';

    setTimeout(() => {
        const reply = generateAIResponse(rawQuery.toLowerCase());
        addChatMessage('assistant', reply);
    }, 600);
}

/**
 * Appends a chat message bubble to the conversation log.
 * User messages are sanitized (XSS-safe). Assistant messages may contain
 * trusted HTML (formatted with `<br>` and `<strong>` for readability).
 *
 * @param {'user'|'assistant'} sender - Who sent the message
 * @param {string} text - Message text (user input will be sanitized)
 * @returns {void}
 */
function addChatMessage(sender, text) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;

    const content = document.createElement('div');
    content.className = 'message-content';

    if (sender === 'user') {
        // User input is untrusted: use textContent to prevent XSS
        content.textContent = text;
    } else {
        // Assistant messages are internally generated (trusted HTML)
        content.innerHTML = text;
    }

    msg.appendChild(content);
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Trim and persist chat history
    state.chatHistory.push({ sender, text: sender === 'user' ? sanitizeHTML(text) : text });
    if (state.chatHistory.length > 20) state.chatHistory.shift();
    saveState();
}

/**
 * Generates a context-aware AI response based on keyword matching and
 * the current calculator state (persona + emission breakdown).
 *
 * @param {string} query - Lowercase user query string
 * @returns {string} HTML-formatted assistant response
 */
function generateAIResponse(query) {
    const score      = parseFloat(totalFootprintVal.textContent);
    const topCat     = getTopCategory();
    const pct        = getCategoryPercentages();
    const maxPct     = pct[topCat];

    const advice = {
        transport: 'Consider switching short car rides for cycling, or grouping your trips. If driving is essential, look into public transit or EV options.',
        energy:    'Check your thermostat settings. Installing a smart thermostat and opting for LED lighting are immediate wins.',
        food:      'Reducing meat intake, particularly beef and lamb, is one of the single fastest ways to lower your footprint.',
        waste:     'Composting waste and cutting out single-use plastics can divert critical emissions from landfills.'
    };

    // Keyword routing
    if (/commute|car|drive|vehicle|transport|transit/.test(query)) {
        return `I notice your transportation emissions are a key factor. Swap driving for public transit where possible. If you are a Daily Commuter, choosing an Electric Vehicle can decrease your travel footprint by nearly 70% (down to 0.05 kg CO₂/km)!`;
    }

    if (/food|diet|meat|vegan|veg|eat/.test(query)) {
        return `Food production is responsible for a massive share of global greenhouse gases. Switching from a heavy-meat diet (approx. 2.9 tons/yr) to a plant-based vegan diet (1.0 tons/yr) saves about 1.9 tons of CO₂ annually! Can you start with checking off "Meatless Mondays" in the Mitigation Action Tracker?`;
    }

    if (/energy|electricity|solar|power|heating|led/.test(query)) {
        return `Home energy optimization is crucial. Washing laundry in cold water saves 0.12 tons/yr, while switching standard bulbs to LEDs saves about 0.30 tons/yr. Look for the "Pledge Green Energy Supply" action in the tracker which could reduce your home footprint to zero!`;
    }

    if (/recycl|waste|compost|plastic|trash/.test(query)) {
        return `Recycling correctly provides a direct deduction of 0.2 tons from your annual footprint. Composting food waste prevents methane releases in landfills and saves an additional 0.18 tons/yr. Look at our Zero Waste items in the checklist!`;
    }

    if (/hi|hello|hey/.test(query)) {
        return `Hello! How can I help you optimize your carbon footprint today? Ask me how your transport, energy, or diet footprint impacts the planet.`;
    }

    // Default summary with context
    return `Your current carbon footprint is estimated at <strong>${score} Metric Tons</strong> per year. Your largest carbon contributor is <strong>${topCat.toUpperCase()}</strong> (${maxPct}%).<br><br>To improve, I suggest prioritizing: ${advice[topCat]}. What specific aspect of your lifestyle would you like to explore next?`;
}

/**
 * Triggers a predefined assistant response for the quick-action suggestion buttons.
 *
 * @param {'analyze'|'reduce'|'offset'} actionType - Which analysis to perform
 * @returns {void}
 */
function triggerAssistantResponse(actionType) {
    if (actionType === 'analyze') {
        const score    = parseFloat(totalFootprintVal.textContent);
        const diffText = score < NATIONAL_AVERAGE ? 'below' : 'above';
        const percent  = Math.abs(((score - NATIONAL_AVERAGE) / NATIONAL_AVERAGE) * 100).toFixed(0);
        const pct      = getCategoryPercentages();

        addChatMessage('user', 'Analyze my footprint');
        setTimeout(() => {
            addChatMessage('assistant',
                `Here is your EcoSense Analysis:
                <br>• <strong>Current Footprint:</strong> ${score.toFixed(1)} Metric Tons CO₂e/yr.
                <br>• <strong>Performance:</strong> You are ${percent}% ${diffText} the average citizen (${NATIONAL_AVERAGE} tons).
                <br>• <strong>Breakdown Highlights:</strong> Transport is ${pct.transport}%, Energy is ${pct.energy}%, Food is ${pct.food}%, and Waste is ${pct.waste}%.
                <br><br>Let's focus on checking off actions in the checklist below to bring your total down!`
            );
        }, 500);

    } else if (actionType === 'reduce') {
        addChatMessage('user', 'What should I reduce first?');
        setTimeout(() => {
            const topCat = getTopCategory();
            const recommended = MITIGATION_ACTIONS.find(
                a => a.category === topCat && !state.completedActions.includes(a.id)
            );
            const adviceText = recommended
                ? `Based on your high footprint in <strong>${topCat.toUpperCase()}</strong>, I recommend starting with: <strong>${recommended.title}</strong> (-${recommended.impact}t CO₂e). ${recommended.desc} Click it in the tracker to apply this savings.`
                : `Great job! You've already completed the top recommendations for your primary emission category. Consider checking other actions like "Pledge Green Energy Supply" for massive energy offsets!`;
            addChatMessage('assistant', adviceText);
        }, 500);

    } else if (actionType === 'offset') {
        addChatMessage('user', 'Explain tree equivalency');
        setTimeout(() => {
            const trees = Math.round(parseFloat(totalFootprintVal.textContent) * EQUIVALENCY_FACTORS.treesPerTon);
            addChatMessage('assistant',
                `An average mature tree absorbs roughly <strong>22 kg (0.022 tons)</strong> of carbon dioxide per year.
                <br><br>Based on your current annual emissions, you would need to grow <strong>${trees} trees</strong> for a full year to offset your lifestyle footprint. Reducing emissions directly at the source is always more effective than offsetting!`
            );
        }, 500);
    }
}

// =============================================================================
// SECTION 12: Initialization (Browser-only)
// =============================================================================

/**
 * Application entry point. Runs on DOMContentLoaded.
 * Loads persisted state, wires all event listeners, and renders initial UI.
 * Only executes in browser context (guards against Node.js test runner).
 *
 * @returns {void}
 */
if (IS_BROWSER) document.addEventListener('DOMContentLoaded', () => {
    loadState();

    // Persona card click & keyboard handlers
    const personaCards = document.querySelectorAll('.persona-option-card');
    personaCards.forEach(card => {
        card.addEventListener('click', () => selectPersona(card.dataset.persona));
        card.addEventListener('keydown', (e) => {
            // Activate on Enter or Space (WAI-ARIA button pattern)
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectPersona(card.dataset.persona);
            }
        });
    });

    changePersonaBtn.addEventListener('click', () => {
        onboardingModal.classList.remove('hidden');
        // Move focus inside the modal for keyboard users
        const firstCard = onboardingModal.querySelector('.persona-option-card');
        if (firstCard) firstCard.focus();
    });

    // Tab navigation
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            tabContents.forEach(c => c.classList.add('hidden'));

            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            const targetContent = document.getElementById(btn.getAttribute('data-tab'));
            if (targetContent) targetContent.classList.remove('hidden');
        });
    });

    // General input listeners
    setupGeneralListeners();

    // Action checklist
    renderActionList();

    // Chat suggestion buttons
    sugAnalyze.addEventListener('click', () => triggerAssistantResponse('analyze'));
    sugReduce.addEventListener('click',  () => triggerAssistantResponse('reduce'));
    sugOffset.addEventListener('click',  () => triggerAssistantResponse('offset'));

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleUserMessage();
    });

    // Show/hide onboarding modal
    if (!state.currentPersona) {
        onboardingModal.classList.remove('hidden');
        // Auto-focus the first persona card for keyboard users
        const firstCard = onboardingModal.querySelector('.persona-option-card');
        if (firstCard) firstCard.focus();
    } else {
        onboardingModal.classList.add('hidden');
        applyPersonaUI();
        updateCalculations();
    }
});

// =============================================================================
// SECTION 13: Exports for unit testing (Node.js compatible)
// =============================================================================

// Export pure functions when running in Node.js test environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateFootprint,
        roundToHundred,
        sanitizeHTML,
        FACTORS,
        NATIONAL_AVERAGE,
        EQUIVALENCY_FACTORS,
        MIN_WASTE_FLOOR,
        MIN_NET_EMISSIONS,
        MITIGATION_ACTIONS
    };
}
