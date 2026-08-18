import { readFile, writeFile } from "node:fs/promises";

const exampleDirectory = new URL("../examples/blog-electrical/", import.meta.url);
const legacyModel = JSON.parse(await readFile(
  new URL("legacy-model.json", exampleDirectory),
  "utf8"
));

function timeSeriesForNode(nodeName) {
  const node = legacyModel.nodes.find((candidate) => candidate.name === nodeName);
  const values = node?.sockets[0]?.state?.timeSeries;
  if (!Array.isArray(values) || values.length !== legacyModel.config.timeSteps) {
    throw new Error(`Legacy node does not contain the expected profile: ${nodeName}`);
  }
  return values.map((powerW) => powerW / 1000);
}

const model = {
  schemaVersion: "0.1.0",
  id: "model.blog-electrical",
  name: "Domestic solar and battery",
  components: [
    {
      id: "grid",
      type: "electrical.grid",
      definitionVersion: "0.2.0",
      name: "Grid",
      parameters: {
        maximumImportPowerkW: 1000,
        maximumExportPowerkW: 1000
      },
      initialState: {}
    },
    {
      id: "bus",
      type: "electrical.bus",
      definitionVersion: "0.3.0",
      name: "Electrical bus",
      parameters: {},
      initialState: {}
    },
    {
      id: "pv",
      type: "electrical.pv",
      definitionVersion: "0.2.0",
      name: "Solar PV",
      parameters: {
        generationSeriesId: "solar-generation",
        profileMultiplier: 1
      },
      initialState: {}
    },
    {
      id: "load",
      type: "electrical.load",
      definitionVersion: "0.2.0",
      name: "Electrical load",
      parameters: {
        demandSeriesId: "electrical-demand",
        profileMultiplier: 1
      },
      initialState: {}
    },
    {
      id: "battery",
      type: "electrical.battery",
      definitionVersion: "0.2.0",
      name: "Battery",
      parameters: {
        capacitykWh: 5,
        maximumChargePowerkW: 3,
        maximumDischargePowerkW: 3,
        chargingEfficiency: 1,
        dischargingEfficiency: 1
      },
      initialState: {
        storedEnergykWh: 0
      }
    }
  ],
  connections: [
    {
      id: "grid-to-bus",
      name: "Grid to bus",
      from: { componentId: "grid", portId: "electricity" },
      to: { componentId: "bus", portId: "terminal" }
    },
    {
      id: "pv-to-bus",
      name: "Solar PV to bus",
      from: { componentId: "pv", portId: "electricity-out" },
      to: { componentId: "bus", portId: "terminal" }
    },
    {
      id: "bus-to-load",
      name: "Bus to electrical load",
      from: { componentId: "bus", portId: "terminal" },
      to: { componentId: "load", portId: "electricity-in" }
    },
    {
      id: "battery-to-bus",
      name: "Battery to bus",
      from: { componentId: "battery", portId: "electricity" },
      to: { componentId: "bus", portId: "terminal" }
    }
  ]
};

const scenario = {
  schemaVersion: "0.1.0",
  id: "scenario.blog-electrical-reference-day",
  name: "Domestic solar reference day",
  time: {
    timeStepSeconds: legacyModel.config.timeStepSize,
    stepCount: legacyModel.config.timeSteps
  },
  series: [
    {
      id: "electrical-demand",
      name: "Electrical demand",
      unit: "kW",
      data: {
        kind: "inline",
        values: timeSeriesForNode("Load")
      }
    },
    {
      id: "solar-generation",
      name: "Solar generation",
      unit: "kW",
      data: {
        kind: "inline",
        values: timeSeriesForNode("Solar PV")
      }
    }
  ]
};

const layout = {
  schemaVersion: "0.1.0",
  id: "layout.blog-electrical",
  modelId: model.id,
  components: [
    { componentId: "pv", x: 20, y: 40 },
    { componentId: "grid", x: 20, y: 220 },
    { componentId: "bus", x: 260, y: 130 },
    { componentId: "battery", x: 260, y: 370 },
    { componentId: "load", x: 500, y: 40 }
  ]
};

const variants = [
  {
    filename: "variant-double-pv.json",
    document: {
      schemaVersion: "0.1.0",
      id: "variant.blog-electrical-double-pv",
      name: "Double solar PV",
      baseModelId: model.id,
      parameterOverrides: [
        { componentId: "pv", parameter: "profileMultiplier", value: 2 }
      ]
    }
  },
  {
    filename: "variant-double-battery-capacity.json",
    document: {
      schemaVersion: "0.1.0",
      id: "variant.blog-electrical-double-battery-capacity",
      name: "Double battery capacity",
      baseModelId: model.id,
      parameterOverrides: [
        { componentId: "battery", parameter: "capacitykWh", value: 10 }
      ]
    }
  }
];

async function writeJson(filename, document) {
  await writeFile(
    new URL(filename, exampleDirectory),
    `${JSON.stringify(document, null, 2)}\n`
  );
}

await Promise.all([
  writeJson("model.json", model),
  writeJson("scenario.json", scenario),
  writeJson("layout.json", layout),
  ...variants.map(({ filename, document }) => writeJson(filename, document))
]);
