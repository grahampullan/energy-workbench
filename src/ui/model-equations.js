import katex from "katex";

function paragraph(text) {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

function maths(tex, displayMode) {
  const element = document.createElement(displayMode ? "div" : "span");
  element.className = displayMode ? "model-equation" : "model-symbol";
  katex.render(tex, element, {
    displayMode,
    output: "htmlAndMathml",
    throwOnError: true,
    strict: "error",
    trust: false
  });
  return element;
}

function explanationSection(kind, explanation) {
  const section = document.createElement("section");
  section.className = "model-explanation";
  section.dataset.explanationKind = kind;
  const eyebrow = paragraph({ component: "Component equations", policy: "Policy rules", role: "Physical role" }[kind]);
  eyebrow.className = "eyebrow";
  const title = document.createElement("h3");
  title.textContent = explanation.title;
  section.append(eyebrow, title, paragraph(explanation.summary));

  for (const equation of explanation.equations) {
    const label = document.createElement("h4");
    label.textContent = equation.label;
    section.append(label, maths(equation.tex, true));
  }

  if (explanation.symbols.length > 0) {
    const details = document.createElement("details");
    details.className = "model-symbols";
    const summary = document.createElement("summary");
    summary.textContent = "Symbols and units";
    const list = document.createElement("dl");
    for (const symbol of explanation.symbols) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      term.append(maths(symbol.tex, false));
      const definition = document.createElement("dd");
      definition.textContent = symbol.unit
        ? `${symbol.description} (${symbol.unit})`
        : symbol.description;
      row.append(term, definition);
      list.append(row);
    }
    details.append(summary, list);
    section.append(details);
  }

  if (kind === "policy" && explanation.notes.length > 0) {
    const heading = document.createElement("h4");
    heading.textContent = "Operating rules";
    const list = document.createElement("ul");
    for (const note of explanation.notes) {
      const item = document.createElement("li");
      item.textContent = note;
      list.append(item);
    }
    section.append(heading, list);
  }
  return section;
}

export function createModelEquations(component) {
  const panel = document.createElement("div");
  panel.className = "inspector-equations";
  if (component.modelExplanation) {
    panel.append(explanationSection("component", component.modelExplanation));
  } else {
    panel.append(paragraph("Equations have not yet been documented for this component."));
  }
  if (component.policyExplanation) {
    panel.append(explanationSection("policy", component.policyExplanation));
  }
  if (component.roleExplanation) {
    panel.append(explanationSection("role", component.roleExplanation));
  }
  return panel;
}
