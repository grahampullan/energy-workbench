export function createTestComponentDefinition({
  type = "electrical.source",
  version = "0.1.0",
  name = "Test component",
  parameters = {},
  initialState = {},
  ports = [],
  outputs = {},
  editor = {},
  validate = () => [],
  model = {}
} = {}) {
  return {
    type,
    version,
    name,
    parameters,
    initialState,
    ports,
    outputs,
    editor,
    validate,
    model: {
      prepare: model.prepare ?? (() => ({})),
      initialise: model.initialise ?? (() => ({})),
      getOperatingLimits: model.getOperatingLimits ?? (() => ({})),
      evaluate: model.evaluate ?? (() => ({}))
    }
  };
}
