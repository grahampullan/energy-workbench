export function createDiagnostic({ severity = "error", code, message, path = "" }) {
  if (severity !== "error" && severity !== "warning") {
    throw new TypeError(`Unsupported diagnostic severity: ${severity}`);
  }
  if (typeof code !== "string" || code.length === 0) {
    throw new TypeError("A diagnostic code is required");
  }
  if (typeof message !== "string" || message.length === 0) {
    throw new TypeError("A diagnostic message is required");
  }

  return { severity, code, message, path };
}

export function createValidationResult(diagnostics = []) {
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}
