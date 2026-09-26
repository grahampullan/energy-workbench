import { visibleInformationConnections } from "./information-view.js";

function overlaps(a, b) {
  return a.x < b.x + b.width + 12 && a.x + a.width + 12 > b.x && a.y < b.y + b.height + 12 && a.y + a.height + 12 > b.y;
}

export function informationSourcePositions(sources, connections, boxes) {
  const occupied = [...boxes.values()].map((box) => box.untransformed ?? box);
  return sources.filter((source) => connections.some(({ from }) => from.sourceId === source.id)).map((source) => {
    const connection = connections.find(({ from }) => from.sourceId === source.id);
    const box = boxes.get(connection.to.componentId);
    const target = box.untransformed ?? box;
    const width = 170, height = 40;
    const candidates = [
      { x: target.x, y: target.y + target.height + 24 },
      { x: target.x, y: target.y - height - 24 },
      { x: target.x + target.width + 36, y: target.y },
      ...Array.from({ length: 20 }, (_, i) => ({ x: target.x + (i % 3) * 190, y: target.y + target.height + 24 + Math.floor(i / 3) * 58 }))
    ].map((p) => ({ ...p, width, height }));
    const position = candidates.find((p) => p.x >= 0 && p.y >= 0 && !occupied.some((b) => overlaps(p, b))) ?? candidates.at(-1);
    occupied.push(position);
    return { ...source, ...position };
  });
}

function route(connection, boxes) {
  const from = boxes.get(connection.fromComponentId), to = boxes.get(connection.toComponentId);
  if (!from || !to) return null;
  if (from === to) {
    const x = from.x + from.width, y = from.y + from.height / 2;
    return { ...connection, path: `M${x},${y - 18} C${x + 52},${y - 52} ${x + 52},${y + 52} ${x},${y + 18}`, labelX: x + 40, labelY: y, self: true };
  }
  const fromCentre = from.x + from.width / 2, toCentre = to.x + to.width / 2;
  if (connection.from.sourceId && (from.y >= to.y + to.height || from.y + from.height <= to.y)) {
    const down = to.y > from.y;
    const y1 = from.y + (down ? from.height : 0), y2 = to.y + (down ? 0 : to.height);
    const middleY = (y1 + y2) / 2;
    return { ...connection, path: `M${fromCentre},${y1} C${fromCentre},${middleY} ${toCentre},${middleY} ${toCentre},${y2}`, labelX: fromCentre, labelY: from.y - 10 };
  }
  if (Math.abs(fromCentre - toCentre) < Math.min(from.width, to.width) / 2) {
    const down = to.y > from.y;
    const y1 = from.y + (down ? from.height : 0), y2 = to.y + (down ? 0 : to.height);
    if (Math.abs(y2 - y1) < 32) {
      const x1 = from.x + from.width, x2 = to.x + to.width;
      const sourceY = from.y + from.height / 2, targetY = to.y + to.height / 2;
      const laneX = Math.max(x1, x2) + 44;
      return { ...connection, path: `M${x1},${sourceY} C${laneX},${sourceY} ${laneX},${targetY} ${x2},${targetY}`, labelX: laneX + 12, labelY: (sourceY + targetY) / 2 - 5 };
    }
    return { ...connection, path: `M${fromCentre},${y1} L${toCentre},${y2}`, labelX: (fromCentre + toCentre) / 2, labelY: (y1 + y2) / 2 - 5 };
  }
  const rightward = to.x >= from.x;
  const x1 = from.x + (rightward ? from.width : 0), y1 = from.y + from.height / 2;
  const x2 = to.x + (rightward ? 0 : to.width), y2 = to.y + to.height / 2;
  const cx = (x1 + x2) / 2, cy = Math.min(y1, y2) - 44;
  const between = [...boxes.values()].filter((box) => box !== from && box !== to &&
    box.x < Math.max(x1, x2) && box.x + box.width > Math.min(x1, x2));
  const obstructed = between.some((box) => Array.from({ length: 19 }, (_, i) => (i + 1) / 20).some((t) => {
    const x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2;
    const y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2;
    return x > box.x - 8 && x < box.x + box.width + 8 && y > box.y - 8 && y < box.y + box.height + 8;
  }));
  if (obstructed) {
    const laneY = Math.min(y1, y2, ...between.map((box) => box.y)) - 20;
    const sourceX = x1 + (rightward ? 20 : -20), targetX = x2 + (rightward ? -20 : 20);
    return { ...connection, path: `M${x1},${y1} H${sourceX} V${laneY} H${targetX} V${y2} H${x2}`, labelX: cx, labelY: laneY - 5 };
  }
  return { ...connection, path: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, labelX: cx, labelY: (y1 + y2) / 4 + cy / 2 - 5 };
}

export function renderInformationLayer(content, boxes, view, onHighlight) {
  const visible = visibleInformationConnections(view.informationConnections ?? [], view.selectedComponentId, view.showInformationConnections, view.highlightedConnectionId);
  const groups = new Map();
  for (const connection of visible) {
    const key = `${connection.fromComponentId}/${connection.toComponentId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(connection);
  }
  const routes = [...groups.values()].flatMap((group) => {
    const active = group.find(({ id }) => id === view.highlightedConnectionId) ?? group[0];
    return group.map((connection) => {
      const geometry = route(connection, boxes);
      if (!geometry) return null;
      const highlighted = connection.id === view.highlightedConnectionId;
      const to = boxes.get(connection.toComponentId);
      return { ...geometry, visible: connection === active,
        displayLabel: highlighted ? connection.label : group.length > 1 ? `${group.length} inputs` : connection.name,
        labelX: highlighted || geometry.self ? to.x + to.width / 2 : geometry.labelX,
        labelY: highlighted || geometry.self ? to.y - 12 : geometry.labelY };
    }).filter(Boolean);
  });
  const links = content.selectAll("g.information-link").data(routes, (d) => d.id).join((enter) => {
    const group = enter.append("g").attr("class", "information-link");
    group.append("path").attr("class", "information-line").attr("marker-end", "url(#information-arrow)");
    group.append("text").attr("class", "information-label");
    group.append("path").attr("class", "information-hit");
    return group;
  }).attr("data-information-connection-id", (d) => d.id)
    .classed("information-link--highlighted", (d) => d.id === view.highlightedConnectionId)
    .style("display", (d) => d.visible ? null : "none");
  // Selecting each child propagates the current route data after a box moves.
  links.select(".information-line").attr("d", (d) => d.path);
  links.select("text").attr("x", (d) => d.labelX).attr("y", (d) => d.labelY).text((d) => d.displayLabel);
  links.select(".information-hit").attr("d", (d) => d.path)
    .on("pointerenter", (_, d) => onHighlight(d.id)).on("pointerleave", () => onHighlight(null));
}
