import { useEffect, useState } from "react";
import { RotateCcw, CheckCircle2 } from "lucide-react";
import { api } from "../services/api";
import type { ToothRecord } from "../services/api";
import { TOOTH_PATHS } from "./teethPaths";
import { useTheme } from "../components/ThemeContext";

const CONDITIONS = [
  "Healthy",
  "Caries",
  "Root Canal",
  "Crown",
  "Missing",
  "Extracted",
  "Implant",
  "Filling",
  "Other",
];

const SURFACES = ["Mesial", "Occlusal", "Distal", "Buccal", "Lingual"];

const CONDITION_COLORS: Record<string, string> = {
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

const VIEW_BOX = "0 0 339.55557 59.111111";

interface TeethChartProps {
  patientId: number;
}

export const TeethChart = ({ patientId }: TeethChartProps) => {
  const { colors } = useTheme();
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [records, setRecords] = useState<Record<number, ToothRecord>>({});
  const [hoveredTooth, setHoveredTooth] = useState<number | null>(null);

  // Local draft state
  const [draftNotes, setDraftNotes] = useState("");
  const [draftCondition, setDraftCondition] = useState("Healthy");
  const [draftSurfaces, setDraftSurfaces] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    // Ignore stale responses: rapidly switching patients must not let an
    // older request overwrite the newer patient's records.
    let cancelled = false;
    loadTeeth().then((data) => {
      if (!cancelled && data) setRecords(data);
    });
    return () => { cancelled = true; };
  }, [patientId]);

  const loadTeeth = async (): Promise<Record<number, ToothRecord> | null> => {
    setLoading(true);
    try {
      const data = await api.getPatientTeeth(patientId);
      const byTooth: Record<number, ToothRecord> = {};
      data.forEach((r) => {
        byTooth[r.tooth_number] = r;
      });
      return byTooth;
    } catch (err) {
      console.error("Failed to load tooth records", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const selectTooth = (id: number) => {
    setSelectedTooth(id);
    setSaveError(null);
    setSavedAt(null);
    const existing = records[id];

    // Parse note text if surface tags were saved inside brackets
    const notes = existing?.notes || "";
    const surfaceMatch = notes.match(/^\[Surfaces:\s*(.*?)\]\s*(.*)$/s);
    if (surfaceMatch) {
      setDraftSurfaces(surfaceMatch[1].split(", ").filter(Boolean));
      setDraftNotes(surfaceMatch[2]);
    } else {
      setDraftSurfaces([]);
      setDraftNotes(notes);
    }

    setDraftCondition(existing?.condition || "Healthy");
  };

  const toggleSurface = (surface: string) => {
    setDraftSurfaces((prev) =>
      prev.includes(surface)
        ? prev.filter((s) => s !== surface)
        : [...prev, surface]
    );
  };

  const saveTooth = async () => {
    if (selectedTooth === null) return;
    setSaving(true);
    setSaveError(null);

    try {
      const existing = records[selectedTooth];

      // Combine surfaces prefix with notes if surfaces exist
      const formattedNotes =
        draftSurfaces.length > 0
          ? `[Surfaces: ${draftSurfaces.join(", ")}]\n${draftNotes}`.trim()
          : draftNotes;

      const payload = {
        patient_id: patientId,
        tooth_number: selectedTooth,
        condition: draftCondition,
        notes: formattedNotes,
      };

      let saved: ToothRecord;
      if (existing) {
        saved = await api.updateToothRecord(existing.id, payload);
      } else {
        saved = await api.createToothRecord(payload);
      }

      setRecords((prev) => ({ ...prev, [selectedTooth]: saved }));
      setSavedAt(Date.now());
    } catch (err) {
      console.error("Failed to save tooth record", err);
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const resetTooth = async () => {
    if (selectedTooth === null) return;
    const existing = records[selectedTooth];

    setDraftCondition("Healthy");
    setDraftSurfaces([]);
    setDraftNotes("");

    if (existing) {
      setSaving(true);
      try {
        const saved = await api.updateToothRecord(existing.id, {
          patient_id: patientId,
          tooth_number: selectedTooth,
          condition: "Healthy",
          notes: "",
        });
        setRecords((prev) => ({ ...prev, [selectedTooth]: saved }));
        setSavedAt(Date.now());
      } catch (err) {
        console.error("Failed to reset tooth record", err);
        setSaveError("Failed to reset record.");
      } finally {
        setSaving(false);
      }
    }
  };

  const getFill = (toothNumber: number) => {
    const record = records[toothNumber];
    if (selectedTooth === toothNumber) return "var(--accent-hover)";
    if (hoveredTooth === toothNumber) return "var(--accent-hover)";
    if (record) return CONDITION_COLORS[record.condition] || "#ffffff";
    return "#ffffff";
  };

  const getStroke = (toothNumber: number) =>
    selectedTooth === toothNumber ? "var(--accent)" : "var(--text-muted)";

  // Summary statistics
  const totalTeeth = 32;
  const cariesCount = Object.values(records).filter((r) => r.condition === "Caries").length;
  const missingCount = Object.values(records).filter((r) =>
    ["Missing", "Extracted"].includes(r.condition)
  ).length;
  const treatedCount = Object.values(records).filter((r) =>
    ["Root Canal", "Crown", "Implant", "Filling"].includes(r.condition)
  ).length;
  // Anything not explicitly counted above (e.g. "Other") is NOT healthy --
  // subtracting it from the total keeps the summary honest.
  const otherCount = Object.values(records).filter((r) =>
    !["Healthy", "Caries", "Missing", "Extracted", "Root Canal", "Crown", "Implant", "Filling"].includes(r.condition)
  ).length;

  const selectedToothInfo = TOOTH_PATHS.find((t) => t.toothNumber === selectedTooth);

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: colors.textSecondary }}>
        Loading odontogram…
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", background: colors.bgCard, borderRadius: "12px", border: `1px solid ${colors.border}` }}>
      {/* Diagnostic Summary Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          paddingBottom: "12px",
          borderBottom: `1px solid ${colors.border}`,
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <h3 style={{ margin: 0, color: colors.text }}>Odontogram & Clinical Charting</h3>
        <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
          <span style={{ color: colors.danger, fontWeight: 600 }}>Caries: {cariesCount}</span>
          <span style={{ color: colors.accent, fontWeight: 600 }}>Treated: {treatedCount}</span>
          <span style={{ color: colors.textMuted, fontWeight: 600 }}>Missing: {missingCount}</span>
          <span style={{ color: colors.textMuted, fontWeight: 600 }}>Other: {otherCount}</span>
          <span style={{ color: colors.success, fontWeight: 600 }}>
            Healthy: {totalTeeth - cariesCount - missingCount - treatedCount - otherCount}
          </span>
        </div>
      </div>

      {/* Anatomical Odontogram SVG */}
      <div
        style={{
          background: colors.bg,
          borderRadius: "8px",
          border: `1px solid ${colors.border}`,
          padding: "16px",
          overflowX: "auto",
        }}
      >
        <svg viewBox={VIEW_BOX} style={{ width: "100%", minWidth: "700px", height: "auto" }}>
          {TOOTH_PATHS.map((tooth) => (
            <g
              key={tooth.toothNumber}
              onClick={() => selectTooth(tooth.toothNumber)}
              onMouseEnter={() => setHoveredTooth(tooth.toothNumber)}
              onMouseLeave={() => setHoveredTooth(null)}
              style={{ cursor: "pointer" }}
            >
              {tooth.paths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  fill={getFill(tooth.toothNumber)}
                  stroke={getStroke(tooth.toothNumber)}
                  strokeWidth={selectedTooth === tooth.toothNumber ? 1.5 : 0.8}
                  style={{ transition: "fill 0.15s ease, stroke-width 0.15s ease" }}
                >
                  <title>
                    Universal #{tooth.toothNumber} | FDI #{tooth.fdiNumber} ({tooth.name})
                  </title>
                </path>
              ))}
            </g>
          ))}
        </svg>
      </div>

      {/* Dynamic Clinical Inspector Panel */}
      <div
        style={{
          marginTop: "20px",
          padding: "20px",
          background: colors.bg,
          borderRadius: "8px",
          border: `1px solid ${colors.border}`,
        }}
      >
        {selectedTooth && selectedToothInfo ? (
          <div>
            {/* Header info */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                borderBottom: `1px solid ${colors.border}`,
                paddingBottom: "10px",
              }}
            >
              <div>
                <strong style={{ fontSize: "16px", color: colors.text }}>
                  Tooth #{selectedToothInfo.toothNumber} (FDI #{selectedToothInfo.fdiNumber})
                </strong>
                <span style={{ display: "block", fontSize: "13px", color: colors.textSecondary, marginTop: "2px" }}>
                  {selectedToothInfo.name}
                </span>
              </div>
              <button
                onClick={resetTooth}
                disabled={saving}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: colors.dangerBg,
                  color: colors.danger,
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <RotateCcw size={14} />
                Reset to Healthy
              </button>
            </div>

            {/* Quick-Click Condition Pills */}
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: colors.textSecondary, marginBottom: "8px" }}>
              Condition
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
              {CONDITIONS.map((c) => {
                const isActive = draftCondition === c;
                return (
                  <button
                    key={c}
                    onClick={() => setDraftCondition(c)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "999px",
                      border: isActive ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
                      background: isActive ? colors.accentHover : CONDITION_COLORS[c] || colors.bgCard,
                      color: isActive ? colors.accent : colors.text,
                      fontSize: "13px",
                      fontWeight: isActive ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            {/* Surface Tagging (MODBL) */}
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: colors.textSecondary, marginBottom: "8px" }}>
              Affected Surfaces (MODBL)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
              {SURFACES.map((s) => {
                const isActive = draftSurfaces.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSurface(s)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: isActive ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                      background: isActive ? colors.accent : colors.bgInput,
                      color: isActive ? colors.accentText : colors.text,
                      fontSize: "13px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            {/* Clinical Notes */}
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: colors.textSecondary, marginBottom: "6px" }}>
              Clinical Observations
            </label>
            <textarea
              rows={3}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: `1px solid ${colors.border}`,
                boxSizing: "border-box",
                fontSize: "14px",
                fontFamily: "inherit",
                background: colors.bgInput,
                color: colors.text,
              }}
              placeholder={`Enter specific observations for Tooth #${selectedTooth}...`}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
            />

            {saveError && (
              <p style={{ color: colors.danger, fontSize: "13px", marginTop: "8px" }}>{saveError}</p>
            )}

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
              <button
                onClick={saveTooth}
                disabled={saving}
                style={{
                  background: colors.accent,
                  color: colors.accentText,
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 18px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {saving ? "Saving…" : "Save Tooth Record"}
              </button>

              {savedAt && (
                <span style={{ display: "flex", alignItems: "center", gap: "4px", color: colors.success, fontSize: "13px", fontWeight: 600 }}>
                  <CheckCircle2 size={16} /> Saved successfully
                </span>
              )}
            </div>
          </div>
        ) : (
          <p style={{ textAlign: "center", color: colors.textMuted, fontStyle: "italic", margin: "16px 0" }}>
            Select any anatomical tooth above to update conditions, tag surfaces, or write clinical notes.
          </p>
        )}
      </div>
    </div>
  );
};