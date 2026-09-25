import { schemeTableau10 } from "d3";

export function tableauColour(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError("A non-negative colour index is required");
  }
  return schemeTableau10[index % schemeTableau10.length];
}

export function createConnectionColourScale(connectionIds) {
  if (
    !Array.isArray(connectionIds) ||
    connectionIds.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(connectionIds).size !== connectionIds.length
  ) {
    throw new TypeError("Unique connection IDs are required for topology colours");
  }
  const coloursByConnectionId = new Map(connectionIds.map((id, index) => [
    id,
    tableauColour(index)
  ]));
  const indexesByConnectionId = new Map(connectionIds.map((id, index) => [
    id,
    index
  ]));
  return Object.freeze({
    size: connectionIds.length,
    indexFor(connectionId) {
      const index = indexesByConnectionId.get(connectionId);
      if (index === undefined) {
        throw new Error(`Connection colour is not defined: ${connectionId}`);
      }
      return index;
    },
    colourFor(connectionId) {
      const colour = coloursByConnectionId.get(connectionId);
      if (colour === undefined) {
        throw new Error(`Connection colour is not defined: ${connectionId}`);
      }
      return colour;
    }
  });
}
