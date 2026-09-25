const MAXIMUM_SIGNIFICANT_DIGITS = 4;
const SCIENTIFIC_LOWER_BOUND = 1e-3;
const SCIENTIFIC_UPPER_BOUND = 1e6;

function scale(unit, entries) {
  return [unit, entries.map(([displayUnit, factor]) => Object.freeze({
    unit: displayUnit,
    factor
  }))];
}

const UNIT_SCALES = new Map([
  scale("kW", [
    ["pW", 1e-15],
    ["nW", 1e-12],
    ["µW", 1e-9],
    ["mW", 1e-6],
    ["W", 1e-3],
    ["kW", 1],
    ["MW", 1e3],
    ["GW", 1e6],
    ["TW", 1e9]
  ]),
  scale("kWh", [
    ["µWh", 1e-9],
    ["mWh", 1e-6],
    ["Wh", 1e-3],
    ["kWh", 1],
    ["MWh", 1e3],
    ["GWh", 1e6],
    ["TWh", 1e9]
  ]),
  scale("kg", [
    ["µg", 1e-9],
    ["mg", 1e-6],
    ["g", 1e-3],
    ["kg", 1],
    ["t", 1e3],
    ["kt", 1e6]
  ]),
  scale("kg/s", [
    ["µg/s", 1e-9],
    ["mg/s", 1e-6],
    ["g/s", 1e-3],
    ["kg/s", 1],
    ["t/s", 1e3]
  ]),
  scale("kgCO2", [
    ["µgCO2", 1e-9],
    ["mgCO2", 1e-6],
    ["gCO2", 1e-3],
    ["kgCO2", 1],
    ["tCO2", 1e3],
    ["ktCO2", 1e6]
  ]),
  scale("kgCO2/h", [
    ["µgCO2/h", 1e-9],
    ["mgCO2/h", 1e-6],
    ["gCO2/h", 1e-3],
    ["kgCO2/h", 1],
    ["tCO2/h", 1e3]
  ]),
  scale("kgCO2/kWh", [
    ["µgCO2/kWh", 1e-9],
    ["mgCO2/kWh", 1e-6],
    ["gCO2/kWh", 1e-3],
    ["kgCO2/kWh", 1],
    ["tCO2/kWh", 1e3]
  ]),
  scale("kJ/kg", [
    ["mJ/kg", 1e-6],
    ["J/kg", 1e-3],
    ["kJ/kg", 1],
    ["MJ/kg", 1e3],
    ["GJ/kg", 1e6]
  ]),
  scale("kJ / kgK", [
    ["mJ / kgK", 1e-6],
    ["J / kgK", 1e-3],
    ["kJ / kgK", 1],
    ["MJ / kgK", 1e3]
  ]),
  scale("kW/K", [
    ["mW/K", 1e-6],
    ["W/K", 1e-3],
    ["kW/K", 1],
    ["MW/K", 1e3],
    ["GW/K", 1e6]
  ]),
  scale("K", [
    ["nK", 1e-9],
    ["µK", 1e-6],
    ["mK", 1e-3],
    ["K", 1]
  ])
]);

function visibleUnit(unit) {
  return unit === "1" || unit === "scenario-series-id" ? "" : unit;
}

function roundedMagnitude(value) {
  return Math.abs(Number(value.toPrecision(MAXIMUM_SIGNIFICANT_DIGITS)));
}

function resolveScale(referenceValue, unit) {
  const entries = UNIT_SCALES.get(unit);
  if (!entries || !Number.isFinite(referenceValue) || referenceValue === 0) {
    return Object.freeze({ factor: 1, unit: visibleUnit(unit) });
  }

  const magnitude = Math.abs(referenceValue);
  let index = entries.findLastIndex(({ factor }) => magnitude >= factor);
  index = Math.max(0, index);
  if (
    index < entries.length - 1 &&
    roundedMagnitude(referenceValue / entries[index].factor) >= 1000
  ) {
    index += 1;
  }
  return entries[index];
}

export function formatEngineeringNumber(value) {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const normalisedValue = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalisedValue);
  const notation = magnitude !== 0 && (
    magnitude < SCIENTIFIC_LOWER_BOUND || magnitude >= SCIENTIFIC_UPPER_BOUND
  )
    ? "scientific"
    : "standard";
  return new Intl.NumberFormat("en-GB", {
    maximumSignificantDigits: MAXIMUM_SIGNIFICANT_DIGITS,
    minimumSignificantDigits: 1,
    notation,
    useGrouping: true
  }).format(normalisedValue);
}

export function createEngineeringDisplayScale(referenceValue, unit = "") {
  const resolved = resolveScale(referenceValue, unit);
  return Object.freeze({
    unit: resolved.unit,
    convert(value) {
      return value / resolved.factor;
    },
    format(value) {
      return formatEngineeringNumber(value / resolved.factor);
    }
  });
}

export function formatEngineeringValue(value, unit = "") {
  if (typeof value === "number") {
    const display = createEngineeringDisplayScale(value, unit);
    const formattedValue = display.format(value);
    return display.unit ? `${formattedValue} ${display.unit}` : formattedValue;
  }
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}
