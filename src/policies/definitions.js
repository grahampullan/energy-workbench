function input(label, quantity, unit) {
  return { label, quantity, unit };
}

function explanation(title, summary, equations, symbols = []) {
  return {
    title, summary,
    equations: equations.map(([label, tex]) => ({ label, tex })),
    symbols: symbols.map(([tex, description, unit]) => ({ tex, description, unit })),
    notes: []
  };
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
  return value;
}

export const policyDefinitions = [
  {
    type: "electrical.self-consumption",
    name: "Use surplus power",
    componentTypes: ["electrical.battery"],
    inputs: {
      generation: input("Generation", "active-power", "kW"),
      demand: input("Demand", "active-power", "kW")
    },
    settings: {},
    explanation: explanation("Use surplus power", "Charge with surplus power; discharge to cover a shortfall.", [
      ["Battery power request", String.raw`P_{\mathrm{requested}}=P_{\mathrm{demand}}-P_{\mathrm{generation}}`]
    ], [[String.raw`P_{\mathrm{requested}}`, "Positive discharges; negative charges", "kW"], [String.raw`P_{\mathrm{generation}}`, "Connected generation", "kW"], [String.raw`P_{\mathrm{demand}}`, "Connected demand", "kW"]]),
    request({ generation, demand }) {
      return { powerkW: nonNegative(demand, "Demand") - nonNegative(generation, "Generation") };
    }
  },
  {
    type: "thermal.follow-demand",
    name: "Follow heat demand",
    componentTypes: ["thermal.electric-heater"],
    inputs: {
      demand: input("Requested heat", "heat-rate", "kW"),
      efficiency: input("Heater efficiency", "efficiency", "1")
    },
    settings: {},
    explanation: explanation("Follow heat demand", "Set heater power from the connected heat request.", [
      ["Electrical power request", String.raw`P_{\mathrm{requested}}=-\frac{\dot Q_{\mathrm{demand}}}{\eta}`]
    ], [[String.raw`\dot Q_{\mathrm{demand}}`, "Requested heat", "kW"], [String.raw`\eta`, "Heater efficiency", "1"]]),
    request({ demand, efficiency }) {
      nonNegative(demand, "Heat demand");
      if (!(efficiency > 0)) throw new RangeError("Efficiency must be positive");
      return { powerkW: demand === 0 ? 0 : -demand / efficiency };
    }
  },
  {
    type: "electrical.follow-schedule",
    name: "Follow power schedule",
    componentTypes: ["thermal.electric-heater", "electrical.source", "electrical.battery", "electrical.grid"],
    inputs: { power: input("Power schedule", "active-power", "kW") },
    settings: { direction: { label: "Power direction", unit: "1", default: -1, choices: [{ value: -1, label: "Consume / charge" }, { value: 1, label: "Supply / discharge" }] } },
    explanation: explanation("Follow power schedule", "Follow the connected power schedule in the selected direction.", [
      ["Power request", String.raw`P_{\mathrm{requested}}=s\,P_{\mathrm{schedule}}`]
    ], [["s", "Selected direction: −1 consumes, +1 supplies", "1"], [String.raw`P_{\mathrm{schedule}}`, "Non-negative scheduled power", "kW"]]),
    request({ power }, { direction }) { return { powerkW: direction * nonNegative(power, "Scheduled power") }; }
  },
  {
    type: "thermal.follow-schedule",
    name: "Follow heating schedule",
    componentTypes: ["thermal.fuel-burner"],
    inputs: {
      request: input("Heating schedule", "heat-rate", "kW")
    },
    settings: {},
    explanation: explanation("Follow heating schedule", "Request heat from the heating schedule.", [
      ["Heat request", String.raw`\dot Q_{\mathrm{requested}}=\dot Q_{\mathrm{schedule}}`]
    ], [[String.raw`\dot Q_{\mathrm{schedule}}`, "Scheduled heating power", "kW"]]),
    request({ request }) { return { heatOutputkW: nonNegative(request, "Scheduled heat") }; }
  },
  {
    type: "material.follow-schedule",
    requiredPorts: ["material-out"],
    name: "Follow discharge schedule",
    componentTypes: ["thermal.store"],
    inputs: {
      request: input("Discharge schedule", "mass-rate", "kg/s")
    },
    settings: {},
    explanation: explanation("Follow discharge schedule", "Request flow from the discharge schedule.", [
      ["Discharge request", String.raw`\dot m_{\mathrm{requested}}=\dot m_{\mathrm{schedule}}`]
    ], [[String.raw`\dot m_{\mathrm{schedule}}`, "Scheduled discharge; the store limits actual discharge to available material", "kg/s"]]),
    request({ request }) { return { massOutflowKgPerSecond: nonNegative(request, "Scheduled discharge") }; }
  },
  {
    type: "thermal.reach-temperature",
    name: "Heat towards temperature",
    componentTypes: ["thermal.fuel-burner"],
    inputs: {
      temperature: input("Temperature", "temperature", "°C"),
      capacity: input("Heat capacity", "thermal-capacity", "kWh/K"),
      required: input("Required temperature", "temperature", "°C"),
      maximum: input("Maximum temperature", "temperature", "°C"),
      "power-limit": input("Burner heat limit", "heat-rate", "kW"),
      remaining: input("Heating time remaining", "duration", "h")
    },
    settings: { margin: { label: "Temperature margin", unit: "K", default: 10, minimum: 0 } },
    explanation: explanation("Heat towards temperature", "Heat towards the required temperature in the time available.", [
      ["Target temperature", String.raw`T_* = \min(T_{\max},T_{\mathrm{required}}+\Delta T)`],
      ["Heat request", String.raw`\dot Q_{\mathrm{requested}}=\begin{cases}\min\!\left(\dot Q_{\max},\frac{C\max(0,T_*-T)}{\tau}\right)&\tau>0\\0&\text{otherwise}\end{cases}`]
    ], [["T", "Connected body's current temperature", "°C"], ["C", "Connected body's heat capacity", "kJ/K"], [String.raw`\tau`, "Time remaining in this heating period, including this timestep", "s"], [String.raw`\Delta T`, "Configured temperature margin", "K"]]),
    request({ temperature, capacity, required, maximum, "power-limit": powerLimit, remaining }, { margin }) {
      nonNegative(capacity, "Heat capacity");
      nonNegative(powerLimit, "Heat limit");
      nonNegative(remaining, "Time remaining");
      if (remaining === 0) return { heatOutputkW: 0 };
      const target = Math.min(maximum, required + margin);
      return { heatOutputkW: Math.min(powerLimit, capacity * Math.max(0, target - temperature) / remaining) };
    }
  },
  {
    type: "electrical.balance",
    name: "Power balancing",
    componentTypes: ["electrical.grid", "electrical.battery", "electrical.source"],
    inputs: {}, settings: {}, role: "electrical-balance",
    explanation: explanation("Power balancing", "Supply or absorb the requested power, within the component's limits.", []),
    request() { return null; }
  }
];
