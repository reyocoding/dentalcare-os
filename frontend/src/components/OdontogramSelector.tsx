import { TOOTH_PATHS } from "../pages/teethPaths";

const VIEW_BOX = "0 0 339.55557 59.111111";

interface OdontogramSelectorProps {
  selectedTooth?: number;          // Universal tooth number (1-32)
  onSelect?: (tooth: number) => void;
  // Multi-select mode: pass selectedTeeth + onToggle to let users pick
  // several teeth (e.g. a treatment covering multiple teeth).
  selectedTeeth?: number[];
  onToggle?: (tooth: number) => void;
  readOnly?: boolean;
  // optional condition map for colouring teeth (like in TeethChart)
  conditions?: Record<number, string>;
}

export const OdontogramSelector = ({
  selectedTooth,
  onSelect,
  selectedTeeth,
  onToggle,
  readOnly = false,
  conditions = {},
}: OdontogramSelectorProps) => {
  const handleClick = (toothNumber: number) => {
    if (readOnly) return;
    if (onToggle) {
      onToggle(toothNumber);
    } else if (onSelect) {
      onSelect(toothNumber);
    }
  };

  const isSelected = (toothNumber: number) => {
    if (onToggle && selectedTeeth) return selectedTeeth.includes(toothNumber);
    return selectedTooth === toothNumber;
  };

  const getFill = (toothNumber: number) => {
    if (isSelected(toothNumber)) return "var(--accent-hover)";
    const condition = conditions[toothNumber];
    const colorMap: Record<string, string> = {
      Healthy: "#ffffff",
      Caries: "#fecaca",
      "Root Canal": "#fed7aa",
      Crown: "#bfdbfe",
      Missing: "#f1f5f9",
      Extracted: "#cbd5e1",
      Implant: "#bbf7d0",
      Filling: "#fef08a",
      Other: "#e9d5ff",
    };
    return condition ? colorMap[condition] || "#ffffff" : "#ffffff";
  };

  const getStroke = (toothNumber: number) =>
    isSelected(toothNumber) ? "var(--accent)" : "var(--text-muted)";

  return (
    <div style={{ overflowX: "auto", padding: "8px 0" }}>
      <svg viewBox={VIEW_BOX} style={{ width: "100%", minWidth: "700px", height: "auto" }}>
        {TOOTH_PATHS.map((tooth) => {
          const { toothNumber, fdiNumber, name, paths } = tooth;
          return (
            <g
              key={toothNumber}
              onClick={() => handleClick(toothNumber)}
              style={{ cursor: readOnly ? "default" : "pointer" }}
            >
              {paths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  fill={getFill(toothNumber)}
                  stroke={getStroke(toothNumber)}
                  strokeWidth={isSelected(toothNumber) ? 1.5 : 0.8}
                  style={{ transition: "fill 0.15s ease, stroke-width 0.15s ease" }}
                >
                  <title>
                    FDI #{fdiNumber} – {name}
                  </title>
                </path>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
};