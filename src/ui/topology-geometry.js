function boxEdgePoint(box, toward) {
  const centre = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
  const deltaX = toward.x - centre.x;
  const deltaY = toward.y - centre.y;
  if (deltaX === 0 && deltaY === 0) {
    return centre;
  }
  const scale = 1 / Math.max(
    Math.abs(deltaX) / (box.width / 2),
    Math.abs(deltaY) / (box.height / 2)
  );
  return {
    x: centre.x + deltaX * scale,
    y: centre.y + deltaY * scale
  };
}

export function connectionGeometry(
  boxesByComponentId,
  connections,
  verticalBoundaryComponentIds = new Set()
) {
  return connections.flatMap((connection) => {
    const fromBox = boxesByComponentId.get(connection.fromComponentId);
    const toBox = boxesByComponentId.get(connection.toComponentId);
    if (!fromBox || !toBox) {
      return [];
    }

    const fromCentre = {
      x: fromBox.x + fromBox.width / 2,
      y: fromBox.y + fromBox.height / 2
    };
    const toCentre = {
      x: toBox.x + toBox.width / 2,
      y: toBox.y + toBox.height / 2
    };
    const useVerticalBoundaryEntry = verticalBoundaryComponentIds.has(
      connection.toComponentId
    ) && toBox.y >= fromBox.y + fromBox.height;
    const boundaryEntry = {
      x: Math.max(toBox.x, Math.min(fromCentre.x, toBox.x + toBox.width)),
      y: toBox.y
    };
    const fromEdge = useVerticalBoundaryEntry
      ? boxEdgePoint(fromBox, boundaryEntry)
      : boxEdgePoint(fromBox, toCentre);
    const toEdge = useVerticalBoundaryEntry
      ? boundaryEntry
      : boxEdgePoint(toBox, fromCentre);
    const { x: x1, y: y1 } = fromEdge;
    const { x: x2, y: y2 } = toEdge;
    return [{ ...connection, x1, y1, x2, y2 }];
  });
}
