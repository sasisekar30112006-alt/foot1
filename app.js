/**
 * EcoSense - Carbon Footprint Awareness Platform
 * Core Application Logic & Dynamic Assistant Engine
 */

// --- Constants & Carbon Conversion Factors ---
// Conversions are calculated for annual emissions (metric tons CO₂e per year)
const FACTORS = {
    // Utilities
    electricity: 0.38,   // kg CO2e per kWh. Monthly * 12 / 1000 = tons/yr
    naturalGas: 5.3,     // kg CO2e per therm. Monthly * 12 / 1000 = tons/yr
    
    // Commute (km per week)
    commute: {
        petrol: 0.18,    // kg CO2e per km. Weekly * 52 / 1000 = tons/yr
        diesel: 0.16,    // kg CO2e per km
        ev: 0.05,        // kg CO2e per km (electric grid intensity)
        transit: 0.04    // kg CO2e per km
    },
    
    // Flights (per flight)
    flightsShort: 0.25,  // tons CO2e per short-haul flight
    flightsLong: 1.20,   // tons CO2e per long-haul flight
    
    // Diet
    diet: {
        heavyMeat: 2.9,  // tons CO2e per year
        average: 2.1,    // tons CO2e per year
        vegetarian: 1.4, // tons CO2e per year
        vegan: 1.0       // tons CO2e per year
    },
    
    // Shopping / Consumption & Waste
    shopping: {
        high: 2.5,       // tons CO2e per year
        average: 1.5,
        low: 0.7
    },
    
    // Waste offset
    recycleOffset: -0.2, // tons reduction if recycling
    noRecycleCost: 0.2    // tons increase if not recycling
};

// National average for comparison (US/Global context)
const NATIONAL_AVERAGE = 16.0;

// Mitigation Actions Checklist
const MITIGATION_ACTIONS = [
    {
        id: 'action_led',
        title: 'Switch to LED Bulbs',
        desc: 'Replace standard incandescent bulbs with energy-efficient LEDs.',
        category: 'energy',
        impact: 0.30 // Tons saved per year
    },
    {
        id: 'action_bike',
        title: 'Bike or Walk Short Trips',
        desc: 'Swap driving for cycling or walking 2 days a week.',
        category: 'transport',
        impact: 0.75 // Tons saved per year
    },
    {
        id: 'action_meatless',
        title: 'Adopt "Meatless Mondays"',
        desc: 'Go meat-free for one day every week.',
        category: 'food',
        impact: 0.35 // Tons saved per year
    },
    {
        id: 'action_thermostat',
        title: 'Install a Smart Thermostat',
        desc: 'Optimize heating and cooling schedules at home.',
        category: 'energy',
        impact: 0.45 // Tons saved per year
    },
    {
        id: 'action_cold_wash',
        title: 'Wash Laundry in Cold Water',
        desc: 'Save heating energy on up to 4 loads of laundry a week.',
        category: 'energy',
        impact: 0.12 // Tons saved per year
    },
    {
        id: 'action_compost',
        title: 'Compost Organic Waste',
        desc: 'Reduce methane emissions from food waste in landfills.',
        category: 'waste',
        impact: 0.18 // Tons saved per year
    },
    {
        id: 'action_reusable',
        title: 'Go Zero Single-Use Plastics',
        desc: 'Commit to reusable bottles, bags, and zero-packaging shopping.',
        category: 'waste',
        impact: 0.15 // Tons saved per year
    },
    {
        id: 'action_solar',
        title: 'Pledge Green Energy Supply',
        desc: 'Switch your home energy plan to 100% renewable sources.',
        category: 'energy',
        impact: 1.20 // Tons saved per year
    }
];

// --- Application State ---
let state = {
    currentPersona: null, // commuter, consumer, dweller
    inputs: {
        // Commuter fields
        commuteDist: 150,
        vehicleType: 'petrol',
        
        // Consumer fields
        dietType: 'average',
        shoppingFreq: 'average',
        
        // Dweller fields
        electricity: 350,
        heatingSource: 'gas',
        householdSize: 2,
        
        // General fields
        gas: 30,
        flights: 2,
        flightsLong: 1,
        recycle: 'yes'
    },
    completedActions: [],
    chatHistory: []
};

// --- DOM Elements ---
const onboardingModal = document.getElementById('onboardingModal');
const changePersonaBtn = document.getElementById('changePersonaBtn');
const personaBadgeText = document.getElementById('personaBadgeText');
const currentPersonaBadge = document.getElementById('currentPersonaBadge');
const dynamicPersonaFields = document.getElementById('dynamicPersonaFields');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Calculator general inputs
const inputGas = document.getElementById('inputGas');
const valGas = document.getElementById('valGas');
const inputFlights = document.getElementById('inputFlights');
const valFlights = document.getElementById('valFlights');
const inputLongFlights = document.getElementById('inputLongFlights');
const valLongFlights = document.getElementById('valLongFlights');
const recycleYes = document.getElementById('recycleYes');
const recycleNo = document.getElementById('recycleNo');

// Dashboard metrics
const totalFootprintVal = document.getElementById('totalFootprintVal');
const footprintProgress = document.getElementById('footprintProgress');
const comparisonPct = document.getElementById('comparisonPct');
const comparisonText = document.getElementById('comparisonText');

// Chart elements
const segmentTransport = document.getElementById('segmentTransport');
const segmentEnergy = document.getElementById('segmentEnergy');
const segmentFood = document.getElementById('segmentFood');
const segmentWaste = document.getElementById('segmentWaste');
const valTransport = document.getElementById('valTransport');
const valEnergy = document.getElementById('valEnergy');
const valFood = document.getElementById('valFood');
const valWaste = document.getElementById('valWaste');

// Equivalency elements
const eqFlights = document.getElementById('eqFlights');
const eqPhones = document.getElementById('eqPhones');
const eqTrees = document.getElementById('eqTrees');

// Mitigation Checklist elements
const actionListContainer = document.getElementById('actionListContainer');
const savingsBanner = document.getElementById('savingsBanner');
const totalSavingsVal = document.getElementById('totalSavingsVal');

// Chat elements
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSuggestions = document.getElementById('chatSuggestions');

const sugAnalyze = document.getElementById('sugAnalyze');
const sugReduce = document.getElementById('sugReduce');
const sugOffset = document.getElementById('sugOffset');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    
    // Attach onboarding card click handlers
    document.getElementById('personaCommuter').addEventListener('click', () => selectPersona('commuter'));
    document.getElementById('personaConsumer').addEventListener('click', () => selectPersona('consumer'));
    document.getElementById('personaDweller').addEventListener('click', () => selectPersona('dweller'));
    
    changePersonaBtn.addEventListener('click', () => {
        onboardingModal.classList.remove('hidden');
    });

    // Setup tab navigation
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));
            
            btn.classList.add('active');
            const targetContent = document.getElementById(btn.getAttribute('data-tab'));
            if (targetContent) targetContent.classList.remove('hidden');
        });
    });

    // Set up general input listeners
    setupGeneralListeners();
    
    // Action list initialization
    renderActionList();
    
    // Chat suggestions listeners
    sugAnalyze.addEventListener('click', () => triggerAssistantResponse('analyze'));
    sugReduce.addEventListener('click', () => triggerAssistantResponse('reduce'));
    sugOffset.addEventListener('click', () => triggerAssistantResponse('offset'));
    
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleUserMessage();
    });

    // Check if onboarding is needed
    if (!state.currentPersona) {
        onboardingModal.classList.remove('hidden');
    } else {
        onboardingModal.classList.add('hidden');
        applyPersonaUI();
        updateCalculations();
    }
});

// --- State Management ---
function saveState() {
    localStorage.setItem('ecosense_state', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('ecosense_state');
    if (saved) {
        try {
            state = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse saved state', e);
        }
    }
}

// --- Persona Management ---
function selectPersona(persona) {
    state.currentPersona = persona;
    saveState();
    
    applyPersonaUI();
    onboardingModal.classList.add('hidden');
    updateCalculations();
    
    // Welcome message from EcoGuide based on persona
    chatMessages.innerHTML = ''; // Clear chat
    let welcomeText = '';
    if (persona === 'commuter') {
        welcomeText = `Welcome, Commuter! I've calibrated your model to focus on transportation footprints. Your dashboard will highlight transit and vehicle efficiency. Adjust the travel sliders in the calculator to see the impact!`;
    } else if (persona === 'consumer') {
        welcomeText = `Hello, Conscious Consumer! Your calculations are now calibrated to focus on product life-cycles, diet choices, and household recycling. Let's optimize your consumption footprint.`;
    } else {
        welcomeText = `Greetings, Urban Dweller! We have customized your analysis around home heating, household capacity, and appliance electricity. Adjust your utility inputs below to explore reductions.`;
    }
    
    addChatMessage('assistant', welcomeText);
}

function applyPersonaUI() {
    personaBadgeText.textContent = state.currentPersona === 'commuter' ? 'Daily Commuter' :
                                   state.currentPersona === 'consumer' ? 'Conscious Consumer' : 'Eco Urban Dweller';
    
    // Update badge dot color
    const dot = currentPersonaBadge.querySelector('.badge-dot');
    if (state.currentPersona === 'commuter') {
        dot.style.backgroundColor = 'var(--color-transport)';
        dot.style.boxShadow = '0 0 8px var(--color-transport)';
    } else if (state.currentPersona === 'consumer') {
        dot.style.backgroundColor = 'var(--color-waste)';
        dot.style.boxShadow = '0 0 8px var(--color-waste)';
    } else {
        dot.style.backgroundColor = 'var(--color-energy)';
        dot.style.boxShadow = '0 0 8px var(--color-energy)';
    }

    renderPersonaFields();
}

// Dynamically render calculator fields based on chosen Persona
function renderPersonaFields() {
    dynamicPersonaFields.innerHTML = '';
    
    if (state.currentPersona === 'commuter') {
        dynamicPersonaFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="inputCommute">Weekly Driving Distance (km)</label>
                    <div class="slider-container">
                        <input type="range" id="inputCommute" min="0" max="800" value="${state.inputs.commuteDist}" class="input-slider">
                        <span class="slider-value" id="valCommute">${state.inputs.commuteDist}</span>
                    </div>
                </div>
                <div class="form-group">
                    <label for="inputVehicle">Vehicle / Fuel Type</label>
                    <div class="radio-group">
                        <input type="radio" id="vehiclePetrol" name="vehicleOption" value="petrol" ${state.inputs.vehicleType === 'petrol' ? 'checked' : ''}>
                        <label for="vehiclePetrol">Petrol</label>
                        <input type="radio" id="vehicleDiesel" name="vehicleOption" value="diesel" ${state.inputs.vehicleType === 'diesel' ? 'checked' : ''}>
                        <label for="vehicleDiesel">Diesel</label>
                        <input type="radio" id="vehicleEV" name="vehicleOption" value="ev" ${state.inputs.vehicleType === 'ev' ? 'checked' : ''}>
                        <label for="vehicleEV">Electric (EV)</label>
                        <input type="radio" id="vehicleTransit" name="vehicleOption" value="transit" ${state.inputs.vehicleType === 'transit' ? 'checked' : ''}>
                        <label for="vehicleTransit">Public Transit Only</label>
                    </div>
                </div>
            </div>
        `;
        // Bind event listeners
        const inputCommute = document.getElementById('inputCommute');
        const valCommute = document.getElementById('valCommute');
        inputCommute.addEventListener('input', (e) => {
            valCommute.textContent = e.target.value;
            state.inputs.commuteDist = parseInt(e.target.value);
            saveState();
            updateCalculations();
        });
        
        const vehicleOptions = document.getElementsByName('vehicleOption');
        vehicleOptions.forEach(opt => {
            opt.addEventListener('change', (e) => {
                state.inputs.vehicleType = e.target.value;
                saveState();
                updateCalculations();
            });
        });
        
    } else if (state.currentPersona === 'consumer') {
        dynamicPersonaFields.innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label for="inputDiet">Diet Type</label>
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
                <div class="form-group">
                    <label for="inputShopping">Shopping & Consumption Rate</label>
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
        // Bind event listeners
        const dietOptions = document.getElementsByName('dietOption');
        dietOptions.forEach(opt => {
            opt.addEventListener('change', (e) => {
                state.inputs.dietType = e.target.value;
                saveState();
                updateCalculations();
            });
        });
        
        const shopOptions = document.getElementsByName('shopOption');
        shopOptions.forEach(opt => {
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
                        <input type="range" id="inputElectricity" min="0" max="1200" value="${state.inputs.electricity}" class="input-slider">
                        <span class="slider-value" id="valElectricity">${state.inputs.electricity}</span>
                    </div>
                </div>
                <div class="form-group">
                    <label for="inputHousehold">Household Size</label>
                    <div class="slider-container">
                        <input type="range" id="inputHousehold" min="1" max="6" value="${state.inputs.householdSize}" class="input-slider">
                        <span class="slider-value" id="valHousehold">${state.inputs.householdSize}</span>
                    </div>
                </div>
            </div>
        `;
        // Bind event listeners
        const inputElectricity = document.getElementById('inputElectricity');
        const valElectricity = document.getElementById('valElectricity');
        inputElectricity.addEventListener('input', (e) => {
            valElectricity.textContent = e.target.value;
            state.inputs.electricity = parseInt(e.target.value);
            saveState();
            updateCalculations();
        });
        
        const inputHousehold = document.getElementById('inputHousehold');
        const valHousehold = document.getElementById('valHousehold');
        inputHousehold.addEventListener('input', (e) => {
            valHousehold.textContent = e.target.value;
            state.inputs.householdSize = parseInt(e.target.value);
            saveState();
            updateCalculations();
        });
    }
}

// --- Bind General Calculator Slider Listeners ---
function setupGeneralListeners() {
    inputGas.addEventListener('input', (e) => {
        valGas.textContent = e.target.value;
        state.inputs.gas = parseInt(e.target.value);
        saveState();
        updateCalculations();
    });
    
    inputFlights.addEventListener('input', (e) => {
        valFlights.textContent = e.target.value;
        state.inputs.flights = parseInt(e.target.value);
        saveState();
        updateCalculations();
    });
    
    inputLongFlights.addEventListener('input', (e) => {
        valLongFlights.textContent = e.target.value;
        state.inputs.flightsLong = parseInt(e.target.value);
        saveState();
        updateCalculations();
    });
    
    const recycleOptions = document.getElementsByName('recycleOption');
    recycleOptions.forEach(opt => {
        opt.addEventListener('change', (e) => {
            state.inputs.recycle = e.target.value;
            saveState();
            updateCalculations();
        });
    });
    
    // Sync slider positions from state on load
    inputGas.value = state.inputs.gas;
    valGas.textContent = state.inputs.gas;
    inputFlights.value = state.inputs.flights;
    valFlights.textContent = state.inputs.flights;
    inputLongFlights.value = state.inputs.flightsLong;
    valLongFlights.textContent = state.inputs.flightsLong;
    
    if (state.inputs.recycle === 'yes') {
        recycleYes.checked = true;
    } else {
        recycleNo.checked = true;
    }
}

// --- Core Footprint Calculation Engine ---
function updateCalculations() {
    // 1. Calculate Transportation
    let transportEmissions = 0;
    if (state.currentPersona === 'commuter') {
        const factor = FACTORS.commute[state.inputs.vehicleType];
        transportEmissions += (state.inputs.commuteDist * 52 * factor) / 1000;
    } else {
        // Defaults if not commuting persona (low baseline commute)
        transportEmissions += (60 * 52 * FACTORS.commute.petrol) / 1000;
    }
    // Flights (Short and Long Haul)
    transportEmissions += (state.inputs.flights * FACTORS.flightsShort) + (state.inputs.flightsLong * FACTORS.flightsLong);

    // 2. Calculate Home Energy
    let energyEmissions = 0;
    let householdFactor = 1;
    
    if (state.currentPersona === 'dweller') {
        // Average household electricity emissions, split by family members
        householdFactor = state.inputs.householdSize;
        const electricAnnual = (state.inputs.electricity * 12 * FACTORS.electricity) / 1000;
        energyEmissions += electricAnnual / householdFactor;
    } else {
        // Average fallback energy
        energyEmissions += (280 * 12 * FACTORS.electricity) / 1000; 
    }
    // Gas Usage (heating)
    energyEmissions += ((state.inputs.gas * 12 * FACTORS.naturalGas) / 1000) / householdFactor;

    // 3. Calculate Food
    let foodEmissions = 0;
    if (state.currentPersona === 'consumer') {
        foodEmissions += FACTORS.diet[state.inputs.dietType];
    } else {
        // Balanced average diet
        foodEmissions += FACTORS.diet.average;
    }

    // 4. Calculate Waste / Consumption
    let wasteEmissions = 0;
    if (state.currentPersona === 'consumer') {
        wasteEmissions += FACTORS.shopping[state.inputs.shoppingFreq];
    } else {
        wasteEmissions += FACTORS.shopping.average;
    }
    
    // Add recycling logic
    if (state.inputs.recycle === 'yes') {
        wasteEmissions += FACTORS.recycleOffset;
    } else {
        wasteEmissions += FACTORS.noRecycleCost;
    }
    if (wasteEmissions < 0.2) wasteEmissions = 0.2; // Floor of consumption footprint

    // Total baseline emissions before offsets
    const baseEmissions = transportEmissions + energyEmissions + foodEmissions + wasteEmissions;

    // 5. Deduct checked actions
    let totalReductions = 0;
    state.completedActions.forEach(actionId => {
        const actionObj = MITIGATION_ACTIONS.find(a => a.id === actionId);
        if (actionObj) {
            totalReductions += actionObj.impact;
        }
    });

    const netEmissions = Math.max(0.1, baseEmissions - totalReductions);

    // --- Update Interface Elements ---
    
    // Score displays
    totalFootprintVal.textContent = netEmissions.toFixed(1);
    
    // Comparison display
    const compRatio = (netEmissions / NATIONAL_AVERAGE) * 100;
    footprintProgress.style.width = `${Math.min(100, compRatio)}%`;
    
    if (netEmissions < 8.0) {
        footprintProgress.style.background = 'linear-gradient(90deg, #10b981, #34d399)'; // Bright Green for low footprint
    } else if (netEmissions < 15.0) {
        footprintProgress.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)'; // Amber for moderate
    } else {
        footprintProgress.style.background = 'linear-gradient(90deg, #ef4444, #f87171)'; // Red for high
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

    // Chart Segments rendering
    const categoryTotals = {
        transport: transportEmissions,
        energy: energyEmissions,
        food: foodEmissions,
        waste: wasteEmissions
    };

    renderDonutChart(categoryTotals);
    
    // Equivalencies
    eqFlights.textContent = (netEmissions / 1.6).toFixed(1);
    eqPhones.textContent = Math.round(netEmissions * 121000).toLocaleString();
    eqTrees.textContent = Math.round(netEmissions * 45);

    // Savings banner
    if (totalReductions > 0) {
        savingsBanner.classList.remove('hidden');
        totalSavingsVal.textContent = totalReductions.toFixed(2);
    } else {
        savingsBanner.classList.add('hidden');
    }
    
    // Save updated values to state & localStorage
    state.lastCalculatedScore = netEmissions;
    saveState();
}

// --- Render SVG Donut Chart ---
function renderDonutChart(categories) {
    const total = Object.values(categories).reduce((a, b) => a + b, 0);
    
    // Calculate percentages
    const pctTransport = Math.round((categories.transport / total) * 100);
    const pctEnergy = Math.round((categories.energy / total) * 100);
    const pctFood = Math.round((categories.food / total) * 100);
    const pctWaste = Math.round((categories.waste / total) * 100);

    // Update legend values
    valTransport.textContent = `${pctTransport}%`;
    valEnergy.textContent = `${pctEnergy}%`;
    valFood.textContent = `${pctFood}%`;
    valWaste.textContent = `${pctWaste}%`;

    // SVG dasharray geometry (Circumference of r=15.915 is 100)
    let accum = 0;
    
    // Transport segment
    segmentTransport.style.strokeDasharray = `${pctTransport} 100`;
    segmentTransport.style.strokeDashoffset = `25`; // Dash offset offset is absolute relative to start
    accum += pctTransport;

    // Energy segment
    segmentEnergy.style.strokeDasharray = `${pctEnergy} 100`;
    segmentEnergy.style.strokeDashoffset = `${25 - accum}`;
    accum += pctEnergy;

    // Food segment
    segmentFood.style.strokeDasharray = `${pctFood} 100`;
    segmentFood.style.strokeDashoffset = `${25 - accum}`;
    accum += pctFood;

    // Waste segment
    segmentWaste.style.strokeDasharray = `${pctWaste} 100`;
    segmentWaste.style.strokeDashoffset = `${25 - accum}`;
}

// --- Mitigation Checklist Rendering & Handler ---
function renderActionList() {
    actionListContainer.innerHTML = '';
    
    MITIGATION_ACTIONS.forEach(action => {
        const isChecked = state.completedActions.includes(action.id);
        
        const item = document.createElement('div');
        item.className = `action-item ${isChecked ? 'checked' : ''}`;
        item.dataset.id = action.id;
        
        item.innerHTML = `
            <div class="action-checkbox-wrapper">
                <input type="checkbox" class="action-checkbox" ${isChecked ? 'checked' : ''}>
                <span class="checkbox-custom"></span>
            </div>
            <div class="action-details">
                <span class="action-title">${action.title}</span>
                <span class="action-desc">${action.desc}</span>
            </div>
            <span class="action-impact">-${action.impact}t</span>
        `;
        
        // Setup item click action
        item.addEventListener('click', (e) => {
            // Prevent duplicate triggers if checkbox was directly clicked
            if (e.target.type === 'checkbox') return;
            toggleAction(action.id);
        });

        // Setup direct checkbox listener
        const cb = item.querySelector('.action-checkbox');
        cb.addEventListener('change', () => {
            toggleAction(action.id);
        });

        actionListContainer.appendChild(item);
    });
}

function toggleAction(actionId) {
    const idx = state.completedActions.indexOf(actionId);
    if (idx > -1) {
        state.completedActions.splice(idx, 1);
    } else {
        state.completedActions.push(actionId);
    }
    
    saveState();
    renderActionList();
    updateCalculations();
}

// --- EcoGuide AI Assistant Logic ---
function handleUserMessage() {
    const query = chatInput.value.trim();
    if (!query) return;

    addChatMessage('user', query);
    chatInput.value = '';
    
    // Simulated typing state
    setTimeout(() => {
        const reply = generateAIResponse(query.toLowerCase());
        addChatMessage('assistant', reply);
    }, 600);
}

function addChatMessage(sender, text) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;
    msg.innerHTML = `<div class="message-content">${text}</div>`;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Log to memory
    state.chatHistory.push({ sender, text });
    if (state.chatHistory.length > 20) state.chatHistory.shift(); // keep last 20
    saveState();
}

// Dynamic AI response selector
function generateAIResponse(query) {
    // 1. Analyze profile
    const score = parseFloat(totalFootprintVal.textContent);
    let topCategory = 'transport';
    
    // Retrieve highest percentage
    const pt = parseFloat(valTransport.textContent);
    const pe = parseFloat(valEnergy.textContent);
    const pf = parseFloat(valFood.textContent);
    const pw = parseFloat(valWaste.textContent);
    
    let maxVal = pt;
    if (pe > maxVal) { topCategory = 'energy'; maxVal = pe; }
    if (pf > maxVal) { topCategory = 'food'; maxVal = pf; }
    if (pw > maxVal) { topCategory = 'waste'; maxVal = pw; }

    // Persona-based recommendations
    const advice = {
        transport: 'Consider switching short car rides for cycling, or grouping your trips. If driving is essential, look into public transit or EV options.',
        energy: 'Check your thermostat settings. Installing a smart thermostat and opting for LED lighting are immediate wins.',
        food: 'Reducing meat intake, particularly beef and lamb, is one of the single fastest ways to lower your footprint.',
        waste: 'Composting waste and cutting out single-use plastics can divert critical emissions from landfills.'
    };

    // Keyword matching
    if (query.includes('commute') || query.includes('car') || query.includes('drive') || query.includes('vehicle') || query.includes('transport') || query.includes('transit')) {
        return `I notice your transportation emissions are a key factor. Swap driving for public transit where possible. If you are a Daily Commuter, choosing an Electric Vehicle can decrease your travel footprint by nearly 70% (down to 0.05 kg CO₂/km)!`;
    }
    
    if (query.includes('food') || query.includes('diet') || query.includes('meat') || query.includes('vegan') || query.includes('veg') || query.includes('eat')) {
        return `Food production is responsible for a massive share of global greenhouse gases. Switching from a heavy-meat diet (approx. 2.9 tons/yr) to a plant-based vegan diet (1.0 tons/yr) saves about 1.9 tons of CO₂ annually! Can you start with checking off "Meatless Mondays" in the Mitigation Action Tracker?`;
    }

    if (query.includes('energy') || query.includes('electricity') || query.includes('solar') || query.includes('power') || query.includes('heating') || query.includes('led')) {
        return `Home energy optimization is crucial. Washing laundry in cold water saves 0.12 tons/yr, while switching standard bulbs to LEDs saves about 0.30 tons/yr. Look for the "Pledge Green Energy Supply" action in the action tracker which could reduce your home footprint to zero!`;
    }

    if (query.includes('recycle') || query.includes('waste') || query.includes('compost') || query.includes('plastic') || query.includes('trash')) {
        return `Recycling correctly provides a direct deduction of 0.2 tons from your annual footprint. Composting food waste prevents methane releases in landfills and saves an additional 0.18 tons/yr. Look at our Zero Waste items in the checklist!`;
    }

    if (query.includes('hi') || query.includes('hello') || query.includes('hey')) {
        return `Hello! How can I help you optimize your carbon footprint today? Ask me how your transport, energy, or diet footprint impacts the planet.`;
    }

    // Default summaries
    return `Your current carbon footprint is estimated at **${score} Metric Tons** per year. Your largest carbon contributor is **${topCategory.toUpperCase()}** (${maxVal}%). 
    
    To improve, I suggest prioritizing: ${advice[topCategory]}. What specific aspect of your lifestyle would you like to explore next?`;
}

// Trigger predefined actions from suggestions buttons
function triggerAssistantResponse(actionType) {
    if (actionType === 'analyze') {
        const score = parseFloat(totalFootprintVal.textContent);
        const diffText = score < NATIONAL_AVERAGE ? 'below' : 'above';
        const percent = Math.abs(((score - NATIONAL_AVERAGE) / NATIONAL_AVERAGE) * 100).toFixed(0);
        
        addChatMessage('user', 'Analyze my footprint');
        
        setTimeout(() => {
            const analysis = `Here is your EcoSense Analysis:
            <br>• **Current Footprint:** ${score.toFixed(1)} Metric Tons CO₂e/yr.
            <br>• **Performance:** You are ${percent}% ${diffText} the average citizen (${NATIONAL_AVERAGE} tons).
            <br>• **Breakdown Highlights:** Transport is ${valTransport.textContent}, Energy is ${valEnergy.textContent}, Food is ${valFood.textContent}, and Waste is ${valWaste.textContent}.
            <br><br>Let's focus on checking off actions in the checklist below to bring your total down!`;
            addChatMessage('assistant', analysis);
        }, 500);
        
    } else if (actionType === 'reduce') {
        addChatMessage('user', 'What should I reduce first?');
        
        setTimeout(() => {
            // Find first unchecked action in their top category
            let topCategory = 'transport';
            const pt = parseFloat(valTransport.textContent);
            const pe = parseFloat(valEnergy.textContent);
            const pf = parseFloat(valFood.textContent);
            const pw = parseFloat(valWaste.textContent);
            
            let maxVal = pt;
            if (pe > maxVal) { topCategory = 'energy'; maxVal = pe; }
            if (pf > maxVal) { topCategory = 'food'; maxVal = pf; }
            if (pw > maxVal) { topCategory = 'waste'; maxVal = pw; }

            const recommendedAction = MITIGATION_ACTIONS.find(a => a.category === topCategory && !state.completedActions.includes(a.id));
            
            let adviceText = '';
            if (recommendedAction) {
                adviceText = `Based on your high footprint in **${topCategory.toUpperCase()}**, I recommend starting with: **${recommendedAction.title}** (-${recommendedAction.impact}t CO₂e). ${recommendedAction.desc} Click it in the tracker to apply this savings.`;
            } else {
                adviceText = `Great job! You've already completed the top recommendations for your primary emission category. Consider checking other actions like "Pledge Green Energy Supply" for massive energy offsets!`;
            }
            addChatMessage('assistant', adviceText);
        }, 500);
        
    } else if (actionType === 'offset') {
        addChatMessage('user', 'Explain tree equivalency');
        
        setTimeout(() => {
            const trees = Math.round(parseFloat(totalFootprintVal.textContent) * 45);
            const explanation = `An average mature tree absorbs roughly **22 kg (0.022 tons)** of carbon dioxide per year. 
            <br><br>Based on your current annual emissions, you would need to grow **${trees} trees** for a full year to offset your lifestyle footprint. Reducing emissions directly at the source is always more effective than offsetting!`;
            addChatMessage('assistant', explanation);
        }, 500);
    }
}
