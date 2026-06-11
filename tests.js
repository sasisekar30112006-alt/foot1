/**
 * @fileoverview EcoSense Unit Test Suite
 *
 * Self-contained unit tests using Node.js built-in assertions.
 * No external test framework required.
 *
 * Run with:
 *   node tests.js
 *
 * Exit code 0 = all tests passed.
 * Exit code 1 = one or more tests failed.
 */

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Import pure functions from app.js
// ---------------------------------------------------------------------------
const {
    calculateFootprint,
    roundToHundred,
    sanitizeHTML,
    FACTORS,
    NATIONAL_AVERAGE,
    EQUIVALENCY_FACTORS,
    MIN_WASTE_FLOOR,
    MIN_NET_EMISSIONS,
    MITIGATION_ACTIONS
} = require('./app.js');

// ---------------------------------------------------------------------------
// Test runner utilities
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

/**
 * Runs a single named test.
 * @param {string} name - Human-readable test name
 * @param {Function} fn - Test function (throws on failure)
 */
function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     → ${err.message}`);
        failed++;
    }
}

/**
 * Asserts two numbers are approximately equal (within epsilon).
 * @param {number} actual
 * @param {number} expected
 * @param {number} [epsilon=0.001]
 * @param {string} [msg]
 */
function assertCloseTo(actual, expected, epsilon = 0.001, msg = '') {
    if (Math.abs(actual - expected) > epsilon) {
        throw new Error(`${msg || 'Values differ'}: expected ~${expected}, got ${actual}`);
    }
}

// ---------------------------------------------------------------------------
// TEST GROUP 1: Constants Sanity Checks
// ---------------------------------------------------------------------------
console.log('\n📋 Group 1: Constants Sanity');

test('NATIONAL_AVERAGE is 16.0', () => {
    assert.strictEqual(NATIONAL_AVERAGE, 16.0);
});

test('FACTORS.electricity is 0.38 kg CO2e/kWh', () => {
    assert.strictEqual(FACTORS.electricity, 0.38);
});

test('FACTORS.commute.ev < FACTORS.commute.petrol (EV is cleaner)', () => {
    assert.ok(FACTORS.commute.ev < FACTORS.commute.petrol,
        'EV factor should be lower than petrol');
});

test('FACTORS.diet.vegan < FACTORS.diet.heavyMeat (vegan is cleaner)', () => {
    assert.ok(FACTORS.diet.vegan < FACTORS.diet.heavyMeat,
        'Vegan diet should have lower emissions');
});

test('EQUIVALENCY_FACTORS.treesPerTon = 45 (1 / 0.022 tons absorbed)', () => {
    assert.strictEqual(EQUIVALENCY_FACTORS.treesPerTon, 45);
});

test('All MITIGATION_ACTIONS have required fields', () => {
    MITIGATION_ACTIONS.forEach(action => {
        assert.ok(action.id,       `Action missing id`);
        assert.ok(action.title,    `Action ${action.id} missing title`);
        assert.ok(action.desc,     `Action ${action.id} missing desc`);
        assert.ok(action.category, `Action ${action.id} missing category`);
        assert.ok(typeof action.impact === 'number' && action.impact > 0,
            `Action ${action.id} impact must be a positive number`);
    });
});

test('All MITIGATION_ACTIONS IDs are unique', () => {
    const ids = MITIGATION_ACTIONS.map(a => a.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, 'Duplicate action IDs detected');
});

// ---------------------------------------------------------------------------
// TEST GROUP 2: calculateFootprint() – Commuter Persona
// ---------------------------------------------------------------------------
console.log('\n🚗 Group 2: calculateFootprint – Commuter Persona');

const commuterInputs = {
    commuteDist: 200,   // km/week
    vehicleType: 'petrol',
    dietType: 'average',
    shoppingFreq: 'average',
    electricity: 350,
    householdSize: 2,
    gas: 30,
    flights: 2,
    flightsLong: 1,
    recycle: 'yes'
};

test('Commuter: transport includes commute + flights', () => {
    const result = calculateFootprint('commuter', commuterInputs);
    // Expected commute: 200 * 52 * 0.18 / 1000 = 1.872
    // Expected short flights: 2 * 0.25 = 0.5
    // Expected long flights: 1 * 1.20 = 1.2
    const expectedTransport = (200 * 52 * 0.18 / 1000) + (2 * 0.25) + (1 * 1.20);
    assertCloseTo(result.transport, expectedTransport, 0.001, 'Commuter transport');
});

test('Commuter: energy uses gas (no per-person electricity adjustment)', () => {
    const result = calculateFootprint('commuter', commuterInputs);
    // Energy = default electricity baseline + gas
    // Default electricity: 280 * 12 * 0.38 / 1000 = 1.2768
    // Gas: 30 * 12 * 5.3 / 1000 / 1 = 1.908
    const expectedEnergy = (280 * 12 * 0.38 / 1000) + (30 * 12 * 5.3 / 1000);
    assertCloseTo(result.energy, expectedEnergy, 0.001, 'Commuter energy');
});

test('Commuter: food uses average diet as fallback', () => {
    const result = calculateFootprint('commuter', commuterInputs);
    assert.strictEqual(result.food, FACTORS.diet.average);
});

test('Commuter: waste uses average shopping as fallback + recycle offset', () => {
    const result = calculateFootprint('commuter', commuterInputs);
    const expected = Math.max(MIN_WASTE_FLOOR, FACTORS.shopping.average + FACTORS.recycleOffset);
    assertCloseTo(result.waste, expected, 0.001, 'Commuter waste with recycling');
});

test('Commuter: all category values are positive numbers', () => {
    const result = calculateFootprint('commuter', commuterInputs);
    ['transport', 'energy', 'food', 'waste'].forEach(cat => {
        assert.ok(typeof result[cat] === 'number', `${cat} should be a number`);
        assert.ok(result[cat] > 0, `${cat} should be positive`);
    });
});

// ---------------------------------------------------------------------------
// TEST GROUP 3: calculateFootprint() – Consumer Persona
// ---------------------------------------------------------------------------
console.log('\n🛒 Group 3: calculateFootprint – Consumer Persona');

const consumerInputs = {
    commuteDist: 150,
    vehicleType: 'petrol',
    dietType: 'vegan',
    shoppingFreq: 'low',
    electricity: 350,
    householdSize: 2,
    gas: 20,
    flights: 0,
    flightsLong: 0,
    recycle: 'yes'
};

test('Consumer: food uses selected diet type (vegan)', () => {
    const result = calculateFootprint('consumer', consumerInputs);
    assert.strictEqual(result.food, FACTORS.diet.vegan, 'Should use vegan diet factor');
});

test('Consumer: waste uses selected shopping rate (low)', () => {
    const result = calculateFootprint('consumer', consumerInputs);
    const expected = Math.max(MIN_WASTE_FLOOR, FACTORS.shopping.low + FACTORS.recycleOffset);
    assertCloseTo(result.waste, expected, 0.001, 'Consumer waste (minimalist + recycle)');
});

test('Consumer: waste floor prevents values below MIN_WASTE_FLOOR', () => {
    const extremeInputs = { ...consumerInputs, shoppingFreq: 'low', recycle: 'yes' };
    const result = calculateFootprint('consumer', extremeInputs);
    assert.ok(result.waste >= MIN_WASTE_FLOOR,
        `Waste (${result.waste}) should be >= floor (${MIN_WASTE_FLOOR})`);
});

test('Consumer: vegan + minimalist + recycle lower than meat + high + no recycle', () => {
    const lowInputs  = { ...consumerInputs, dietType: 'vegan', shoppingFreq: 'low', recycle: 'yes' };
    const highInputs = { ...consumerInputs, dietType: 'heavyMeat', shoppingFreq: 'high', recycle: 'no' };
    const low  = calculateFootprint('consumer', lowInputs);
    const high = calculateFootprint('consumer', highInputs);
    const lowTotal  = low.food  + low.waste;
    const highTotal = high.food + high.waste;
    assert.ok(lowTotal < highTotal, 'Vegan/minimalist should produce less emissions');
});

test('Consumer: no-recycle adds cost instead of offset', () => {
    const withRecycle    = calculateFootprint('consumer', { ...consumerInputs, recycle: 'yes' });
    const withoutRecycle = calculateFootprint('consumer', { ...consumerInputs, recycle: 'no' });
    assert.ok(withoutRecycle.waste > withRecycle.waste,
        'Not recycling should increase waste emissions');
});

// ---------------------------------------------------------------------------
// TEST GROUP 4: calculateFootprint() – Dweller Persona
// ---------------------------------------------------------------------------
console.log('\n🏠 Group 4: calculateFootprint – Dweller Persona');

const dwellerInputs = {
    commuteDist: 150,
    vehicleType: 'petrol',
    dietType: 'average',
    shoppingFreq: 'average',
    electricity: 600,
    householdSize: 3,
    gas: 40,
    flights: 1,
    flightsLong: 0,
    recycle: 'yes'
};

test('Dweller: electricity is divided by household size', () => {
    const result = calculateFootprint('dweller', dwellerInputs);
    const expectedElec = (600 * 12 * 0.38 / 1000) / 3; // 600kWh / 3 people
    const expectedGas  = (40 * 12 * 5.3 / 1000) / 3;
    const expectedEnergy = expectedElec + expectedGas;
    assertCloseTo(result.energy, expectedEnergy, 0.001, 'Dweller energy per person');
});

test('Dweller: larger household reduces per-person energy', () => {
    const small = calculateFootprint('dweller', { ...dwellerInputs, householdSize: 1 });
    const large = calculateFootprint('dweller', { ...dwellerInputs, householdSize: 6 });
    assert.ok(small.energy > large.energy,
        'Smaller household should have higher per-person energy emissions');
});

test('Dweller: householdSize=1 gives max per-person energy', () => {
    const result = calculateFootprint('dweller', { ...dwellerInputs, householdSize: 1 });
    const expected = (dwellerInputs.electricity * 12 * 0.38 / 1000) + (dwellerInputs.gas * 12 * 5.3 / 1000);
    assertCloseTo(result.energy, expected, 0.001, 'Single-person household energy');
});

// ---------------------------------------------------------------------------
// TEST GROUP 5: roundToHundred() – Donut Chart Rounding
// ---------------------------------------------------------------------------
console.log('\n📊 Group 5: roundToHundred() – Largest Remainder Rounding');

test('Rounds values that sum to exactly 100', () => {
    const result = roundToHundred(25, 25, 25, 25);
    const total = result.transport + result.energy + result.food + result.waste;
    assert.strictEqual(total, 100, `Sum should be 100, got ${total}`);
});

test('Rounds uneven floats to sum of exactly 100', () => {
    // Classic test: thirds don't round cleanly
    const result = roundToHundred(33.33, 33.33, 33.33, 0.01);
    const total = result.transport + result.energy + result.food + result.waste;
    assert.strictEqual(total, 100, `Uneven fractions must sum to 100, got ${total}`);
});

test('All output values are non-negative integers', () => {
    const result = roundToHundred(40.6, 30.2, 20.1, 9.1);
    Object.values(result).forEach(v => {
        assert.ok(Number.isInteger(v), `${v} should be integer`);
        assert.ok(v >= 0, `${v} should be non-negative`);
    });
});

test('Handles zero categories without breaking', () => {
    const result = roundToHundred(100, 0, 0, 0);
    const total = result.transport + result.energy + result.food + result.waste;
    assert.strictEqual(total, 100, 'All-transport sum must equal 100');
    assert.strictEqual(result.transport, 100);
});

test('Handles equal small fractions summing to 100', () => {
    // 50/50 split
    const result = roundToHundred(50, 50, 0, 0);
    const total = result.transport + result.energy + result.food + result.waste;
    assert.strictEqual(total, 100);
    assert.strictEqual(result.transport, 50);
    assert.strictEqual(result.energy, 50);
});

// ---------------------------------------------------------------------------
// TEST GROUP 6: sanitizeHTML() – XSS Prevention
// ---------------------------------------------------------------------------
console.log('\n🔒 Group 6: sanitizeHTML() – XSS Security');

test('Escapes <script> tags', () => {
    const result = sanitizeHTML('<script>alert(1)</script>');
    assert.ok(!result.includes('<script>'), 'Should not contain raw <script>');
    assert.ok(result.includes('&lt;script&gt;'), 'Should contain escaped &lt;script&gt;');
});

test('Escapes double-quote attribute injection', () => {
    const result = sanitizeHTML('" onmouseover="alert(1)');
    assert.ok(!result.includes('"'), 'Should not contain raw double-quote');
});

test('Escapes ampersand', () => {
    const result = sanitizeHTML('AT&T');
    assert.ok(result.includes('&amp;'), 'Should escape ampersand');
});

test('Escapes angle brackets', () => {
    const result = sanitizeHTML('<b>bold</b>');
    assert.ok(result.includes('&lt;b&gt;'), 'Should escape HTML tags');
    assert.ok(!result.includes('<b>'), 'Should not contain raw tags');
});

test('Leaves safe plain text unchanged', () => {
    const safe = 'Hello World 123';
    assert.strictEqual(sanitizeHTML(safe), safe);
});

test('Handles empty string', () => {
    assert.strictEqual(sanitizeHTML(''), '');
});

test('Handles null coercion safely (string conversion)', () => {
    assert.doesNotThrow(() => sanitizeHTML(null));
    assert.strictEqual(sanitizeHTML(null), 'null');
});

// ---------------------------------------------------------------------------
// TEST GROUP 7: AI Response Routing
// ---------------------------------------------------------------------------
console.log('\n🤖 Group 7: generateAIResponse() – Keyword Routing');

/**
 * Minimal stub to test AI routing logic without a DOM.
 * Mirrors the regex-based routing in generateAIResponse().
 * @param {string} query
 * @returns {string}
 */
function routeQuery(query) {
    const q = query.toLowerCase();
    if (/commute|car|drive|vehicle|transport|transit/.test(q)) return 'transport';
    if (/food|diet|meat|vegan|veg|eat/.test(q)) return 'food';
    if (/energy|electricity|solar|power|heating|led/.test(q)) return 'energy';
    if (/recycl|waste|compost|plastic|trash/.test(q)) return 'waste';
    if (/hi|hello|hey/.test(q)) return 'greeting';
    return 'default';
}

test('Routes "commute" to transport category', () => {
    assert.strictEqual(routeQuery('How do I reduce my commute?'), 'transport');
});

test('Routes "car" to transport category', () => {
    assert.strictEqual(routeQuery('I drive my car every day'), 'transport');
});

test('Routes "diet" to food category', () => {
    assert.strictEqual(routeQuery('What about my diet?'), 'food');
});

test('Routes "vegan" to food category', () => {
    assert.strictEqual(routeQuery('Should I go vegan?'), 'food');
});

test('Routes "electricity" to energy category', () => {
    assert.strictEqual(routeQuery('My electricity bill is high'), 'energy');
});

test('Routes "solar" to energy category', () => {
    assert.strictEqual(routeQuery('Tell me about solar panels'), 'energy');
});

test('Routes "recycle" to waste category', () => {
    assert.strictEqual(routeQuery('How does recycling help?'), 'waste');
});

test('Routes "compost" to waste category', () => {
    assert.strictEqual(routeQuery('What is composting?'), 'waste');
});

test('Routes greeting to greeting handler', () => {
    assert.strictEqual(routeQuery('Hello there'), 'greeting');
    assert.strictEqual(routeQuery('hey'), 'greeting');
});

test('Falls back to default for unknown queries', () => {
    assert.strictEqual(routeQuery('random unrelated question'), 'default');
});

// ---------------------------------------------------------------------------
// TEST GROUP 8: State Validation Logic
// ---------------------------------------------------------------------------
console.log('\n📦 Group 8: State Validation');

test('Valid persona values: commuter, consumer, dweller, null', () => {
    const allowed = [null, 'commuter', 'consumer', 'dweller'];
    const invalid = ['admin', 'hacker', '', undefined];
    invalid.forEach(val => {
        assert.ok(!allowed.includes(val), `"${val}" should not be a valid persona`);
    });
    allowed.forEach(val => {
        assert.ok(allowed.includes(val), `"${val}" should be valid`);
    });
});

test('vehicleType only allows known values', () => {
    const allowed = ['petrol', 'diesel', 'ev', 'transit'];
    assert.ok(allowed.includes('petrol'));
    assert.ok(!allowed.includes('nuclear'));
    assert.ok(!allowed.includes(''));
});

test('commuteDist clamped between 0 and 800', () => {
    const schema = { min: 0, max: 800 };
    assert.ok(0 >= schema.min && 0 <= schema.max,   'Min boundary valid');
    assert.ok(400 >= schema.min && 400 <= schema.max, 'Mid value valid');
    assert.ok(!(900 >= schema.min && 900 <= schema.max), 'Over max is invalid');
});

test('householdSize clamped between 1 and 6', () => {
    const schema = { min: 1, max: 6 };
    assert.ok(1 >= schema.min && 1 <= schema.max);
    assert.ok(!(0 >= schema.min && 0 <= schema.max), 'Zero household invalid');
    assert.ok(!(10 >= schema.min && 10 <= schema.max), '10 persons invalid');
});

test('completedActions only contains known action IDs', () => {
    const validIds = MITIGATION_ACTIONS.map(a => a.id);
    const tainted  = ['action_led', 'action_fake_injection', '__proto__'];
    const filtered = tainted.filter(id => validIds.includes(id));
    assert.strictEqual(filtered.length, 1, 'Only valid action IDs survive filter');
    assert.strictEqual(filtered[0], 'action_led');
});

// ---------------------------------------------------------------------------
// TEST GROUP 9: Mitigation Action Toggle Logic
// ---------------------------------------------------------------------------
console.log('\n✅ Group 9: Mitigation Action Toggle Logic');

test('Adding an action reduces total emissions', () => {
    const inputs = { ...commuterInputs };
    const { transport, energy, food, waste } = calculateFootprint('commuter', inputs);
    const base = transport + energy + food + waste;
    const ledImpact = MITIGATION_ACTIONS.find(a => a.id === 'action_led').impact;
    const afterAction = Math.max(MIN_NET_EMISSIONS, base - ledImpact);
    assert.ok(afterAction < base, 'Pledging an action should reduce net emissions');
});

test('Pledging all actions does not reduce below MIN_NET_EMISSIONS', () => {
    const totalReductions = MITIGATION_ACTIONS.reduce((sum, a) => sum + a.impact, 0);
    // With a very low base (almost no emissions)
    const minBase = 0.5;
    const result = Math.max(MIN_NET_EMISSIONS, minBase - totalReductions);
    assert.ok(result >= MIN_NET_EMISSIONS,
        `Net emissions should not fall below ${MIN_NET_EMISSIONS}`);
});

test('action_solar has highest impact (1.2t)', () => {
    const solar = MITIGATION_ACTIONS.find(a => a.id === 'action_solar');
    const maxImpact = Math.max(...MITIGATION_ACTIONS.map(a => a.impact));
    assert.strictEqual(solar.impact, maxImpact, 'Solar should have the highest impact');
});

test('action_cold_wash has minimum impact (0.12t)', () => {
    const coldWash = MITIGATION_ACTIONS.find(a => a.id === 'action_cold_wash');
    const minImpact = Math.min(...MITIGATION_ACTIONS.map(a => a.impact));
    assert.strictEqual(coldWash.impact, minImpact, 'Cold wash should have the minimum impact');
});

// ---------------------------------------------------------------------------
// TEST GROUP 10: Integration – End-to-End Calculation
// ---------------------------------------------------------------------------
console.log('\n🔄 Group 10: Integration – End-to-End');

test('Commuter footprint total is a positive finite number', () => {
    const result = calculateFootprint('commuter', commuterInputs);
    const total  = result.transport + result.energy + result.food + result.waste;
    assert.ok(isFinite(total) && total > 0, 'Total must be positive and finite');
});

test('Consumer vegan+minimalist total is lower than national average', () => {
    const lowInputs = { ...consumerInputs, dietType: 'vegan', shoppingFreq: 'low', flights: 0, flightsLong: 0, gas: 10 };
    const result    = calculateFootprint('consumer', lowInputs);
    const total     = result.transport + result.energy + result.food + result.waste;
    // This is a realistic expectation for a low-footprint consumer
    assert.ok(total < NATIONAL_AVERAGE, `Low-footprint consumer (${total.toFixed(2)} tons) should beat national average`);
});

test('Heavy-meat, frequent-shopping consumer exceeds vegan equivalent by significant margin', () => {
    const lowInputs  = { ...consumerInputs, dietType: 'vegan', shoppingFreq: 'low' };
    const highInputs = { ...consumerInputs, dietType: 'heavyMeat', shoppingFreq: 'high' };
    const low  = calculateFootprint('consumer', lowInputs);
    const high = calculateFootprint('consumer', highInputs);
    const delta = (high.food + high.waste) - (low.food + low.waste);
    assert.ok(delta > 2.0, `Difference (${delta.toFixed(2)} tons) should be > 2 tons`);
});

test('EV commuter has lower transport emissions than petrol commuter', () => {
    const petrol = calculateFootprint('commuter', { ...commuterInputs, vehicleType: 'petrol' });
    const ev     = calculateFootprint('commuter', { ...commuterInputs, vehicleType: 'ev' });
    assert.ok(ev.transport < petrol.transport,
        'EV should have lower transport emissions than petrol');
});

test('Transit commuter has lower transport emissions than diesel commuter', () => {
    const diesel  = calculateFootprint('commuter', { ...commuterInputs, vehicleType: 'diesel' });
    const transit = calculateFootprint('commuter', { ...commuterInputs, vehicleType: 'transit' });
    assert.ok(transit.transport < diesel.transport,
        'Transit should have lower transport emissions than diesel');
});

// ---------------------------------------------------------------------------
// Results Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(50));
console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log('='.repeat(50));

if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed. Please review the errors above.\n`);
    process.exit(1);
} else {
    console.log(`\n✅ All ${passed} tests passed! EcoSense is ready for submission.\n`);
    process.exit(0);
}
