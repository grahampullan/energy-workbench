import { createComponentRegistry as createRegistry } from "../../src/core/component-registry.js";
import { policyDefinitions } from "../../src/policies/definitions.js";
export function createComponentRegistry(definitions, options = {}) {
  return createRegistry(definitions, { policies: policyDefinitions, ...options });
}
