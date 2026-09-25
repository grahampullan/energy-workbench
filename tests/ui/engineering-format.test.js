import assert from "node:assert/strict";
import test from "node:test";

import {
  createEngineeringDisplayScale,
  formatEngineeringNumber,
  formatEngineeringValue
} from "../../src/ui/engineering-format.js";

test("engineering values use four significant figures and readable SI units", () => {
  assert.equal(formatEngineeringValue(41.2514, "kW"), "41.25 kW");
  assert.equal(formatEngineeringValue(0.005, "kW"), "5 W");
  assert.equal(formatEngineeringValue(0.000002, "kW"), "2 mW");
  assert.equal(formatEngineeringValue(0.0004, "kg"), "400 mg");
  assert.equal(formatEngineeringValue(0.0005, "kg/s"), "500 mg/s");
  assert.equal(formatEngineeringValue(5700, "kg"), "5.7 t");
  assert.equal(formatEngineeringValue(0.000012, "K"), "12 µK");
  assert.equal(formatEngineeringValue(1044.286, "°C"), "1,044 °C");
});

test("engineering formatting preserves non-zero values and non-numeric states", () => {
  assert.equal(formatEngineeringValue(0, "kW"), "0 kW");
  assert.equal(formatEngineeringValue(-0, "kW"), "0 kW");
  assert.equal(formatEngineeringValue(1e-8, "°C"), "1E-8 °C");
  assert.equal(formatEngineeringValue(null, "kW"), "—");
  assert.equal(formatEngineeringValue(true, "1"), "Yes");
  assert.equal(formatEngineeringValue("baseline", "scenario-series-id"), "baseline");
});

test("chart display scales use one unit for a complete numeric axis", () => {
  const powerScale = createEngineeringDisplayScale(0.02, "kW");
  assert.equal(powerScale.unit, "W");
  assert.equal(powerScale.convert(0.005), 5);
  assert.equal(powerScale.format(0.005), "5");

  const temperatureScale = createEngineeringDisplayScale(1044.286, "°C");
  assert.equal(temperatureScale.unit, "°C");
  assert.equal(temperatureScale.format(1044.286), "1,044");
  assert.equal(formatEngineeringNumber(0.0000001), "1E-7");
});
