import assert from "node:assert/strict";
import test from "node:test";

import { connectionGeometry } from "../../src/ui/topology-geometry.js";

test("heat-loss connections enter a wide lower ambient boundary vertically", () => {
  const boxes = new Map([
    ["burner", { x: 40, y: 20, width: 100, height: 80 }],
    ["metal", { x: 240, y: 20, width: 100, height: 80 }],
    ["refractory", { x: 440, y: 20, width: 100, height: 80 }],
    ["ambient", { x: 20, y: 180, width: 540, height: 80 }]
  ]);
  const connections = ["burner", "metal", "refractory"].map(
    (fromComponentId) => ({
      id: `${fromComponentId}-loss`,
      fromComponentId,
      toComponentId: "ambient"
    })
  );

  const geometry = connectionGeometry(
    boxes,
    connections,
    new Set(["ambient"])
  );

  assert.deepEqual(geometry.map(({ x1, y1, x2, y2 }) => ({
    x1,
    y1,
    x2,
    y2
  })), [
    { x1: 90, y1: 100, x2: 90, y2: 180 },
    { x1: 290, y1: 100, x2: 290, y2: 180 },
    { x1: 490, y1: 100, x2: 490, y2: 180 }
  ]);
});

test("ordinary topology connections continue to join box edges", () => {
  const boxes = new Map([
    ["source", { x: 20, y: 20, width: 100, height: 80 }],
    ["sink", { x: 220, y: 20, width: 100, height: 80 }]
  ]);

  const [geometry] = connectionGeometry(boxes, [{
    id: "source-to-sink",
    fromComponentId: "source",
    toComponentId: "sink"
  }]);

  assert.deepEqual(
    { x1: geometry.x1, y1: geometry.y1, x2: geometry.x2, y2: geometry.y2 },
    { x1: 120, y1: 60, x2: 220, y2: 60 }
  );
});
