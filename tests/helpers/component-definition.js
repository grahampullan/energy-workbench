export function createTestComponentDefinition({
  type = "electrical.source",
  version = "0.1.0",
  name = "Test component",
  parameters = {},
  initialState = {},
  ports = [],
  outputs = {},
  editor = {},
  validate = () => []
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
      compile() {},
      initialise() {},
      getOperatingLimits() {},
      evaluate() {}
    }
  };
}
