// src/hooks/useIcon.ts
import { useEffect, useState } from "react";
function createUseIcon(supabase, appName) {
  return function useIcon(style = "b") {
    const [svg, setSvg] = useState(null);
    useEffect(() => {
      if (!appName) return;
      const fetchSvg = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.schema("sbrain_assets").from("assets").select("content").eq("name", appName).eq("category", "icon").contains("tags", { style }).single();
        setSvg(data?.content ?? null);
      };
      fetchSvg().catch(console.error);
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN") fetchSvg();
      });
      return () => subscription.unsubscribe();
    }, [style]);
    return svg;
  };
}

// src/hooks/useSchemaData.ts
import { useState as useState2, useEffect as useEffect2 } from "react";
var EMPTY = { prefix: null, tables: [], foreignKeys: [], error: null };
function useSchemaData(supabase, schemaPrefix) {
  const [fetched, setFetched] = useState2(EMPTY);
  useEffect2(() => {
    let cancelled = false;
    Promise.all([
      supabase.rpc(`${schemaPrefix}_schema_tables`),
      supabase.rpc(`${schemaPrefix}_schema_foreign_keys`)
    ]).then(([tablesRes, fkRes]) => {
      if (cancelled) return;
      const message = tablesRes.error?.message ?? fkRes.error?.message ?? null;
      if (message) {
        setFetched({ prefix: schemaPrefix, tables: [], foreignKeys: [], error: message });
        return;
      }
      const tableRows = tablesRes.data ?? [];
      const fkRows = fkRes.data ?? [];
      setFetched({
        prefix: schemaPrefix,
        tables: tableRows.map((r) => ({ schema: r.schema_name, name: r.table_name, type: r.table_type })),
        foreignKeys: fkRows.map((r) => ({
          fromSchema: r.from_schema,
          fromTable: r.from_table,
          fromColumn: r.from_column,
          toSchema: r.to_schema,
          toTable: r.to_table,
          toColumn: r.to_column
        })),
        error: null
      });
    }).catch((e) => {
      if (!cancelled) setFetched({ prefix: schemaPrefix, tables: [], foreignKeys: [], error: String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, schemaPrefix]);
  const current = fetched.prefix === schemaPrefix;
  return {
    tables: current ? fetched.tables : [],
    foreignKeys: current ? fetched.foreignKeys : [],
    loading: !current,
    error: current ? fetched.error : null
  };
}

// src/hooks/useColumns.ts
import { useState as useState3, useEffect as useEffect3 } from "react";
function useColumns(supabase, schemaPrefix, schema, table) {
  const key = schema && table ? `${schemaPrefix}.${schema}.${table}` : null;
  const [fetched, setFetched] = useState3({ key: null, columns: [] });
  useEffect3(() => {
    if (!schema || !table) return;
    let cancelled = false;
    Promise.resolve(
      supabase.rpc(`${schemaPrefix}_schema_columns`, { p_schema: schema, p_table: table })
    ).then(({ data, error }) => {
      if (cancelled) return;
      const rows = error ? [] : data ?? [];
      setFetched({
        key,
        columns: rows.map((r) => ({
          name: r.column_name,
          dataType: r.data_type,
          isNullable: r.is_nullable === "YES",
          columnDefault: r.column_default ?? null
        }))
      });
    }).catch(() => {
      if (cancelled) return;
      setFetched({ key, columns: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, schemaPrefix, schema, table, key]);
  const current = fetched.key === key;
  return {
    columns: current ? fetched.columns : [],
    loading: key !== null && !current
  };
}

// src/hooks/useDarkClass.ts
import { useSyncExternalStore } from "react";
var subscribe = (onStoreChange) => {
  const el = document.documentElement;
  const obs = new MutationObserver(onStoreChange);
  obs.observe(el, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
};
var getSnapshot = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
var getServerSnapshot = () => "light";
function useDarkClass() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// src/components/SchemaExplorer.tsx
import { useState as useState4, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant
} from "@xyflow/react";

// src/lib/schemaColors.ts
var PALETTE_DARK = [
  { border: "#3b82f6", bg: "#1e3a5f26", text: "#93c5fd", badge: "#1d4ed8" },
  { border: "#22c55e", bg: "#14532d26", text: "#86efac", badge: "#15803d" },
  { border: "#a855f7", bg: "#3b076426", text: "#d8b4fe", badge: "#7e22ce" },
  { border: "#f59e0b", bg: "#451a0326", text: "#fcd34d", badge: "#b45309" },
  { border: "#f43f5e", bg: "#4c051426", text: "#fda4af", badge: "#be123c" },
  { border: "#06b6d4", bg: "#08334426", text: "#67e8f9", badge: "#0e7490" }
];
var PALETTE_LIGHT = [
  { border: "#3b82f6", bg: "#dbeafe", text: "#1d4ed8", badge: "#1d4ed8" },
  { border: "#22c55e", bg: "#dcfce7", text: "#15803d", badge: "#15803d" },
  { border: "#a855f7", bg: "#f3e8ff", text: "#7e22ce", badge: "#7e22ce" },
  { border: "#f59e0b", bg: "#fef3c7", text: "#b45309", badge: "#b45309" },
  { border: "#f43f5e", bg: "#ffe4e6", text: "#be123c", badge: "#be123c" },
  { border: "#06b6d4", bg: "#cffafe", text: "#0e7490", badge: "#0e7490" }
];
function getSchemaColor(schema, orderedSchemas, theme = "dark") {
  const palette = theme === "dark" ? PALETTE_DARK : PALETTE_LIGHT;
  const idx = orderedSchemas.indexOf(schema);
  return palette[(idx >= 0 ? idx : 0) % palette.length];
}
function dangerText(theme) {
  return theme === "dark" ? "#f43f5e" : "#be123c";
}
var CHROME_TOKENS = {
  canvas: "--surface",
  panel: "--surface-raised",
  zebra: "--surface-input",
  subtle: "--line",
  mutedBorder: "--line-strong",
  text: "--fg",
  text2: "--fg",
  mutedText: "--fg-muted",
  faintText: "--fg-subtle",
  mask: "--surface"
};
var CHROME_FALLBACKS = {
  dark: {
    canvas: "#18181b",
    panel: "#27272a",
    zebra: "#35353b",
    subtle: "#3f3f46",
    mutedBorder: "#52525b",
    text: "#f4f4f5",
    text2: "#f4f4f5",
    mutedText: "#a1a1aa",
    faintText: "#8d8d96",
    mask: "#18181b"
  },
  light: {
    canvas: "#ffffff",
    panel: "#ffffff",
    zebra: "#f4f4f5",
    subtle: "#e4e4e7",
    mutedBorder: "#d4d4d8",
    text: "#18181b",
    text2: "#18181b",
    mutedText: "#52525b",
    faintText: "#71717a",
    mask: "#ffffff"
  }
};
function chromeColors(theme) {
  const fallback = CHROME_FALLBACKS[theme];
  const ref = (key) => `var(${CHROME_TOKENS[key]}, ${fallback[key]})`;
  return {
    canvas: ref("canvas"),
    panel: ref("panel"),
    zebra: ref("zebra"),
    subtle: ref("subtle"),
    mutedBorder: ref("mutedBorder"),
    text: ref("text"),
    text2: ref("text2"),
    mutedText: ref("mutedText"),
    faintText: ref("faintText"),
    // The minimap mask must be translucent so the viewport rectangle reads through it, and
    // alpha cannot be appended to a var(). color-mix keeps it token-driven.
    mask: `color-mix(in srgb, ${ref("mask")} 60%, transparent)`
  };
}

// src/lib/schemaLayout.ts
var TABLE_W = 196;
var TABLE_H = 40;
var V_GAP = 8;
var H_GAP = 12;
var PAD_H = 20;
var PAD_TOP = 48;
var PAD_BOT = 16;
var ROW_GAP = 60;
var COL_GAP = 40;
var MAX_PER_ROW = 3;
var MAX_COLS = 6;
function cols(tableCount) {
  const cellW = TABLE_W + H_GAP;
  const cellH = TABLE_H + V_GAP;
  const ideal = Math.ceil(Math.sqrt(tableCount * (cellH / cellW)));
  const floor = tableCount === 1 ? 1 : 2;
  return Math.min(MAX_COLS, Math.max(floor, ideal));
}
function groupWidth(c) {
  return PAD_H * 2 + c * TABLE_W + (c - 1) * H_GAP;
}
function groupHeight(tableCount, c) {
  const rows = Math.ceil(tableCount / c);
  return PAD_TOP + rows * TABLE_H + (rows - 1) * V_GAP + PAD_BOT;
}
function computeLayout(tables, foreignKeys, hiddenSchemas, orderedSchemas, theme = "dark") {
  const tablesBySchema = /* @__PURE__ */ new Map();
  for (const t of tables) {
    if (!tablesBySchema.has(t.schema)) tablesBySchema.set(t.schema, []);
    tablesBySchema.get(t.schema).push(t);
  }
  const visibleSchemas = orderedSchemas.filter((s) => !hiddenSchemas.has(s));
  const rows = [];
  for (let i = 0; i < visibleSchemas.length; i += MAX_PER_ROW) {
    rows.push(visibleSchemas.slice(i, i + MAX_PER_ROW));
  }
  const schemaPositions = /* @__PURE__ */ new Map();
  let rowY = 0;
  for (const row of rows) {
    let rowMaxH = 0;
    let colX = 0;
    for (const schema of row) {
      const count = tablesBySchema.get(schema)?.length ?? 0;
      const c = cols(count);
      const h = groupHeight(count, c);
      schemaPositions.set(schema, { x: colX, y: rowY, c });
      colX += groupWidth(c) + COL_GAP;
      rowMaxH = Math.max(rowMaxH, h);
    }
    rowY += rowMaxH + ROW_GAP;
  }
  const chrome = chromeColors(theme);
  const nodes = [];
  const edges = [];
  for (const schema of visibleSchemas) {
    const pos = schemaPositions.get(schema);
    const schemaTables = tablesBySchema.get(schema) ?? [];
    const color = getSchemaColor(schema, orderedSchemas, theme);
    const c = pos.c;
    const w = groupWidth(c);
    const h = groupHeight(schemaTables.length, c);
    nodes.push({
      id: `group-${schema}`,
      type: "schemaGroup",
      position: { x: pos.x, y: pos.y },
      style: { width: w, height: h },
      data: { schema, color, tableCount: schemaTables.length, theme },
      draggable: true
    });
    schemaTables.forEach((t, i) => {
      const col = i % c;
      const row = Math.floor(i / c);
      nodes.push({
        id: `table-${schema}-${t.name}`,
        type: "tableNode",
        parentId: `group-${schema}`,
        extent: "parent",
        position: { x: PAD_H + col * (TABLE_W + H_GAP), y: PAD_TOP + row * (TABLE_H + V_GAP) },
        style: { width: TABLE_W },
        data: { schema, name: t.name, type: t.type, color, theme },
        draggable: false
      });
    });
  }
  for (const fk of foreignKeys) {
    if (hiddenSchemas.has(fk.fromSchema) || hiddenSchemas.has(fk.toSchema)) continue;
    edges.push({
      id: `fk-${fk.fromSchema}-${fk.fromTable}-${fk.fromColumn}`,
      source: `table-${fk.fromSchema}-${fk.fromTable}`,
      target: `table-${fk.toSchema}-${fk.toTable}`,
      label: `${fk.fromColumn} \u2192 ${fk.toColumn}`,
      type: "smoothstep",
      animated: fk.fromTable === fk.toTable,
      style: { stroke: chrome.mutedText, strokeWidth: 1.5 },
      labelStyle: { fill: chrome.mutedText, fontSize: 10 }
    });
  }
  return { nodes, edges };
}

// src/components/SchemaGroupNode.tsx
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var SchemaGroupNode = memo(({ data, style }) => {
  const { schema, color, tableCount } = data;
  const w = style?.width ?? 460;
  const h = style?.height ?? 300;
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        width: w,
        height: h,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
        background: color.bg,
        position: "relative"
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            position: "absolute",
            top: 10,
            left: 14,
            display: "flex",
            alignItems: "center",
            gap: 8
          },
          children: [
            /* @__PURE__ */ jsx("span", { style: { fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: color.text, letterSpacing: "0.02em" }, children: schema }),
            /* @__PURE__ */ jsxs("span", { style: { fontSize: 10, color: color.text, opacity: 0.6 }, children: [
              tableCount,
              " ",
              tableCount === 1 ? "table" : "tables"
            ] })
          ]
        }
      )
    }
  );
});
SchemaGroupNode.displayName = "SchemaGroupNode";

// src/components/TableNode.tsx
import { memo as memo2 } from "react";
import { Handle, Position } from "@xyflow/react";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var TableNode = memo2(({ data, selected }) => {
  const { name, type, color } = data;
  const c = chromeColors(data.theme);
  const isView = type === "VIEW";
  return /* @__PURE__ */ jsxs2(Fragment, { children: [
    /* @__PURE__ */ jsx2(Handle, { type: "target", position: Position.Left, style: { opacity: 0, width: 6, height: 6 } }),
    /* @__PURE__ */ jsxs2(
      "div",
      {
        style: {
          width: 196,
          height: 40,
          borderRadius: 6,
          border: `1.5px solid ${selected ? color.border : c.mutedBorder}`,
          background: selected ? `${color.border}18` : c.panel,
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          gap: 8,
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
          boxShadow: selected ? `0 0 0 2px ${color.border}44` : "none"
        },
        children: [
          /* @__PURE__ */ jsx2("span", { style: { fontSize: 9, color: color.text, opacity: 0.7, flexShrink: 0, fontFamily: "monospace" }, children: isView ? "VIEW" : "TBL" }),
          /* @__PURE__ */ jsx2("span", { style: {
            fontSize: 11,
            color: selected ? color.text : c.text2,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1
          }, children: name })
        ]
      }
    ),
    /* @__PURE__ */ jsx2(Handle, { type: "source", position: Position.Right, style: { opacity: 0, width: 6, height: 6 } })
  ] });
});
TableNode.displayName = "TableNode";

// src/components/ColumnPanel.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var TYPE_SHORTHANDS = {
  "integer": "int",
  "smallint": "int2",
  "bigint": "int8",
  "numeric": "numeric",
  "real": "float4",
  "double precision": "float8",
  "text": "text",
  "character varying": "varchar",
  "character": "char",
  "boolean": "bool",
  "date": "date",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamptz",
  "jsonb": "jsonb",
  "json": "json",
  "uuid": "uuid"
};
function shortType(t) {
  return TYPE_SHORTHANDS[t] ?? t;
}
function ColumnPanel({ supabase, schemaPrefix, schema, table, color, onClose, theme = "dark" }) {
  const { columns, loading } = useColumns(supabase, schemaPrefix, schema, table);
  if (!schema || !table) return null;
  const c = chromeColors(theme);
  return /* @__PURE__ */ jsxs3("div", { style: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 300,
    background: c.panel,
    borderLeft: `1.5px solid ${color?.border ?? c.mutedBorder}`,
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  }, children: [
    /* @__PURE__ */ jsxs3("div", { style: { padding: "14px 16px 12px", borderBottom: `1px solid ${c.subtle}` }, children: [
      /* @__PURE__ */ jsxs3("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, children: [
        /* @__PURE__ */ jsx3("span", { style: { fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: color?.text ?? c.text2 }, children: table }),
        /* @__PURE__ */ jsx3(
          "button",
          {
            onClick: onClose,
            style: { background: "none", border: "none", color: c.mutedText, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" },
            children: "\xD7"
          }
        )
      ] }),
      /* @__PURE__ */ jsx3("span", { style: { fontFamily: "monospace", fontSize: 10, color: c.mutedText }, children: schema })
    ] }),
    /* @__PURE__ */ jsx3("div", { className: "scroll-slim", style: { flex: 1, overflowY: "auto", padding: "8px 0" }, children: loading ? /* @__PURE__ */ jsx3("div", { style: { padding: "20px 16px", color: c.faintText, fontSize: 12 }, children: "Loading\u2026" }) : columns.length === 0 ? /* @__PURE__ */ jsx3("div", { style: { padding: "20px 16px", color: c.faintText, fontSize: 12 }, children: "No columns found" }) : columns.map((col, i) => /* @__PURE__ */ jsxs3("div", { style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      padding: "5px 16px",
      background: i % 2 === 0 ? "transparent" : c.zebra
    }, children: [
      /* @__PURE__ */ jsxs3("div", { style: { display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }, children: [
        /* @__PURE__ */ jsx3("span", { style: {
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: col.isNullable ? c.mutedBorder : color?.border ?? c.mutedBorder,
          flexShrink: 0
        } }),
        /* @__PURE__ */ jsx3("span", { style: { fontFamily: "monospace", fontSize: 11, color: c.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: col.name })
      ] }),
      /* @__PURE__ */ jsx3("span", { style: { fontFamily: "monospace", fontSize: 10, color: c.mutedText, flexShrink: 0, marginLeft: 8 }, children: shortType(col.dataType) })
    ] }, col.name)) }),
    /* @__PURE__ */ jsxs3("div", { style: { padding: "10px 16px", borderTop: `1px solid ${c.subtle}`, display: "flex", gap: 12 }, children: [
      /* @__PURE__ */ jsxs3("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: [
        /* @__PURE__ */ jsx3("span", { style: { width: 6, height: 6, borderRadius: "50%", background: color?.border ?? c.mutedBorder, display: "inline-block" } }),
        /* @__PURE__ */ jsx3("span", { style: { fontSize: 10, color: c.mutedText }, children: "not null" })
      ] }),
      /* @__PURE__ */ jsxs3("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: [
        /* @__PURE__ */ jsx3("span", { style: { width: 6, height: 6, borderRadius: "50%", background: c.mutedBorder, display: "inline-block" } }),
        /* @__PURE__ */ jsx3("span", { style: { fontSize: 10, color: c.mutedText }, children: "nullable" })
      ] })
    ] })
  ] });
}

// src/components/SchemaControls.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function SchemaControls({ schemas, hidden, tableCountBySchema, onToggle, theme = "dark" }) {
  const c = chromeColors(theme);
  return /* @__PURE__ */ jsxs4("div", { style: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 10,
    background: c.panel,
    border: `1px solid ${c.subtle}`,
    borderRadius: 8,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 180
  }, children: [
    /* @__PURE__ */ jsx4("span", { style: { fontSize: 10, color: c.mutedText, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 2 }, children: "SCHEMAS" }),
    schemas.map((schema) => {
      const color = getSchemaColor(schema, schemas, theme);
      const count = tableCountBySchema[schema] ?? 0;
      const visible = !hidden.has(schema);
      return /* @__PURE__ */ jsxs4(
        "button",
        {
          onClick: () => onToggle(schema),
          style: { display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "2px 0", textAlign: "left" },
          children: [
            /* @__PURE__ */ jsx4("span", { style: {
              width: 10,
              height: 10,
              borderRadius: 2,
              background: visible ? color.border : c.mutedBorder,
              flexShrink: 0,
              transition: "background 0.15s"
            } }),
            /* @__PURE__ */ jsx4("span", { style: { fontFamily: "monospace", fontSize: 11, color: visible ? c.text2 : c.faintText, flex: 1 }, children: schema }),
            /* @__PURE__ */ jsx4("span", { style: { fontSize: 10, color: c.faintText }, children: count })
          ]
        },
        schema
      );
    })
  ] });
}

// src/components/SchemaExplorer.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
var NODE_TYPES = {
  schemaGroup: SchemaGroupNode,
  tableNode: TableNode
};
function SchemaExplorer({ supabase, schemaPrefix, hiddenByDefault = [] }) {
  const theme = useDarkClass();
  const c = chromeColors(theme);
  const { tables, foreignKeys, loading, error } = useSchemaData(supabase, schemaPrefix);
  const [hiddenSchemas, setHiddenSchemas] = useState4(new Set(hiddenByDefault));
  const [selected, setSelected] = useState4(null);
  const orderedSchemas = useMemo(
    () => [...new Set(tables.map((t) => t.schema))].sort(),
    [tables]
  );
  const tableCountBySchema = useMemo(() => {
    const counts = {};
    for (const t of tables) counts[t.schema] = (counts[t.schema] ?? 0) + 1;
    return counts;
  }, [tables]);
  const { nodes, edges } = useMemo(
    () => computeLayout(tables, foreignKeys, hiddenSchemas, orderedSchemas, theme),
    [tables, foreignKeys, hiddenSchemas, orderedSchemas, theme]
  );
  const selectedColor = useMemo(
    () => selected ? getSchemaColor(selected.schema, orderedSchemas, theme) : null,
    [selected, orderedSchemas, theme]
  );
  const onNodeClick = useCallback((_evt, node) => {
    if (node.type !== "tableNode") return;
    const { schema, name } = node.data;
    setSelected(
      (prev) => prev?.schema === schema && prev?.table === name ? null : { schema, table: name }
    );
  }, []);
  const toggleSchema = useCallback((schema) => {
    setHiddenSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
    setSelected(null);
  }, []);
  if (loading) {
    return /* @__PURE__ */ jsx5("div", { style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: c.canvas }, children: /* @__PURE__ */ jsx5("span", { style: { color: c.faintText, fontSize: 13 }, children: "Loading schema\u2026" }) });
  }
  if (error) {
    return /* @__PURE__ */ jsx5("div", { style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: c.canvas }, children: /* @__PURE__ */ jsxs5("span", { style: { color: dangerText(theme), fontSize: 13 }, children: [
      "Error: ",
      error
    ] }) });
  }
  return /* @__PURE__ */ jsxs5("div", { style: { flex: 1, position: "relative", background: c.canvas, overflow: "hidden" }, children: [
    /* @__PURE__ */ jsxs5(
      ReactFlow,
      {
        nodes,
        edges,
        onNodeClick,
        nodeTypes: NODE_TYPES,
        fitView: true,
        fitViewOptions: { padding: 0.12 },
        minZoom: 0.08,
        maxZoom: 2,
        proOptions: { hideAttribution: true },
        colorMode: theme,
        style: { background: c.canvas },
        children: [
          /* @__PURE__ */ jsx5(Background, { variant: BackgroundVariant.Dots, gap: 24, size: 1, color: c.subtle }),
          /* @__PURE__ */ jsx5(Controls, { style: { background: c.panel, border: `1px solid ${c.subtle}` } }),
          /* @__PURE__ */ jsx5(
            MiniMap,
            {
              style: { background: c.panel, border: `1px solid ${c.subtle}` },
              nodeColor: (node) => node.data?.color?.border ?? "#3f3f46",
              maskColor: c.mask
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx5(
      SchemaControls,
      {
        schemas: orderedSchemas,
        hidden: hiddenSchemas,
        tableCountBySchema,
        onToggle: toggleSchema,
        theme
      }
    ),
    /* @__PURE__ */ jsx5(
      ColumnPanel,
      {
        supabase,
        schemaPrefix,
        schema: selected?.schema ?? null,
        table: selected?.table ?? null,
        color: selectedColor,
        onClose: () => setSelected(null),
        theme
      }
    )
  ] });
}

// src/components/SchemaExplorerPanel.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
function SchemaExplorerPanel({ supabase, schemaPrefix, hiddenByDefault = [] }) {
  return /* @__PURE__ */ jsx6("div", { style: { flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }, children: /* @__PURE__ */ jsx6(SchemaExplorer, { supabase, schemaPrefix, hiddenByDefault }) });
}

// src/lib/theme.tsx
import { useEffect as useEffect4, useState as useState5 } from "react";

// src/lib/theme-context.ts
import { createContext, useContext } from "react";
var ThemeContext = createContext({
  theme: "dark",
  toggle: () => {
  },
  isManaged: false
});
var useTheme = () => useContext(ThemeContext);

// src/lib/theme.tsx
import { jsx as jsx7 } from "react/jsx-runtime";
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState5(
    () => localStorage.getItem("theme") ?? "dark"
  );
  useEffect4(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return /* @__PURE__ */ jsx7(ThemeContext.Provider, { value: { theme, toggle: () => setTheme((t) => t === "dark" ? "light" : "dark"), isManaged: true }, children });
}

// src/components/Calendar/Calendar.tsx
import { useState as useState7 } from "react";

// src/lib/calendarUtils.ts
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
function startDayOfWeek(year, month) {
  return new Date(year, month - 1, 1).getDay();
}
function dateFromIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dateToIso(d) {
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function startOfWeek(iso) {
  const d = dateFromIso(iso);
  d.setDate(d.getDate() - d.getDay());
  return dateToIso(d);
}
function addDays(iso, n) {
  const d = dateFromIso(iso);
  d.setDate(d.getDate() + n);
  return dateToIso(d);
}
function monthName(month) {
  return MONTH_NAMES[month - 1];
}
function eventsForDate(events, iso) {
  return events.filter((e) => {
    if (e.endDate) return e.date <= iso && e.endDate >= iso;
    return e.date === iso;
  });
}
function eventsForMonth(events, year, month) {
  const start = isoDate(year, month, 1);
  const end = isoDate(year, month, daysInMonth(year, month));
  return events.filter((e) => {
    const eEnd = e.endDate ?? e.date;
    return e.date <= end && eEnd >= start;
  });
}

// src/lib/calendarColors.ts
var HEAT_STEPS = 5;
var HEAT_DARK = [
  { bg: "#172554", fg: "#f4f4f5" },
  { bg: "#1e3a8a", fg: "#f4f4f5" },
  { bg: "#1e40af", fg: "#f4f4f5" },
  { bg: "#1d4ed8", fg: "#f4f4f5" },
  { bg: "#2563eb", fg: "#f4f4f5" }
];
var HEAT_LIGHT = [
  { bg: "#dbeafe", fg: "#18181b" },
  { bg: "#bfdbfe", fg: "#18181b" },
  { bg: "#93c5fd", fg: "#18181b" },
  { bg: "#60a5fa", fg: "#18181b" },
  { bg: "#3b82f6", fg: "#18181b" }
];
function accentColors(theme) {
  return theme === "dark" ? { text: "#93c5fd", border: "#3b82f6" } : { text: "#1d4ed8", border: "#2563eb" };
}
function heatColor(count, max, theme) {
  const chrome = chromeColors(theme);
  if (count <= 0 || max <= 0) return { bg: chrome.zebra, fg: chrome.mutedText };
  const ramp = theme === "dark" ? HEAT_DARK : HEAT_LIGHT;
  const step = Math.min(HEAT_STEPS - 1, Math.max(0, Math.ceil(count / max * HEAT_STEPS) - 1));
  return ramp[step];
}

// src/components/Calendar/YearView.tsx
import { jsx as jsx8, jsxs as jsxs6 } from "react/jsx-runtime";
var SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function YearView({ events, activeDate, onMonthClick, onNavigate, theme }) {
  const c = chromeColors(theme);
  const year = parseInt(activeDate.slice(0, 4), 10);
  const monthlyCounts = Array.from(
    { length: 12 },
    (_, i) => eventsForMonth(events, year, i + 1).length
  );
  const maxCount = Math.max(...monthlyCounts, 1);
  const navButton = {
    background: "none",
    border: `1px solid ${c.subtle}`,
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    color: "inherit"
  };
  return /* @__PURE__ */ jsxs6("div", { style: { fontFamily: "inherit" }, children: [
    /* @__PURE__ */ jsxs6("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }, children: [
      /* @__PURE__ */ jsx8(
        "button",
        {
          "aria-label": "Previous year",
          onClick: () => onNavigate(isoDate(year - 1, parseInt(activeDate.slice(5, 7), 10), parseInt(activeDate.slice(8, 10), 10))),
          style: navButton,
          children: "\u2039"
        }
      ),
      /* @__PURE__ */ jsx8("span", { style: { fontWeight: 600, fontSize: 14 }, children: year }),
      /* @__PURE__ */ jsx8(
        "button",
        {
          "aria-label": "Next year",
          onClick: () => onNavigate(isoDate(year + 1, parseInt(activeDate.slice(5, 7), 10), parseInt(activeDate.slice(8, 10), 10))),
          style: navButton,
          children: "\u203A"
        }
      )
    ] }),
    /* @__PURE__ */ jsx8("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }, children: SHORT_MONTHS.map((label, i) => {
      const month = i + 1;
      const count = monthlyCounts[i];
      const isActive = parseInt(activeDate.slice(5, 7), 10) === month;
      const heat = heatColor(count, maxCount, theme);
      return /* @__PURE__ */ jsxs6(
        "div",
        {
          onClick: () => onMonthClick(isoDate(year, month, 1)),
          style: {
            background: heat.bg,
            color: heat.fg,
            borderRadius: 6,
            padding: "10px 6px",
            textAlign: "center",
            cursor: "pointer",
            fontSize: 11,
            outline: isActive ? `2px solid ${c.mutedBorder}` : "none"
          },
          children: [
            /* @__PURE__ */ jsx8("div", { children: label }),
            count > 0 && /* @__PURE__ */ jsx8("div", { style: { fontSize: 10, opacity: 0.7, marginTop: 2 }, children: count })
          ]
        },
        label
      );
    }) })
  ] });
}

// src/components/Calendar/MonthView.tsx
import { useState as useState6, useEffect as useEffect5, useRef } from "react";

// src/components/Calendar/CrumbTrail.tsx
import { jsx as jsx9, jsxs as jsxs7 } from "react/jsx-runtime";
function CrumbTrail({ crumbs, theme }) {
  const c = chromeColors(theme);
  return /* @__PURE__ */ jsx9("nav", { "aria-label": "Breadcrumb", style: { display: "flex", alignItems: "center", gap: 6 }, children: crumbs.map((crumb, i) => {
    const isCurrent = i === crumbs.length - 1;
    return /* @__PURE__ */ jsxs7("span", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
      i > 0 && /* @__PURE__ */ jsx9("span", { "aria-hidden": true, style: { color: c.faintText, fontSize: 11 }, children: "\u203A" }),
      /* @__PURE__ */ jsx9(
        "button",
        {
          type: "button",
          "aria-label": crumb.name,
          "aria-current": isCurrent ? "page" : void 0,
          onClick: crumb.onClick,
          style: {
            background: "none",
            border: "none",
            borderRadius: 4,
            padding: "2px 4px",
            cursor: crumb.onClick ? "pointer" : "default",
            color: isCurrent ? "inherit" : c.mutedText,
            fontWeight: isCurrent ? 600 : 400,
            fontSize: isCurrent ? 14 : 12,
            display: "flex",
            alignItems: "center",
            gap: 4
          },
          children: crumb.label
        }
      )
    ] }, i);
  }) });
}

// src/components/Calendar/MonthView.tsx
import { Fragment as Fragment2, jsx as jsx10, jsxs as jsxs8 } from "react/jsx-runtime";
var WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
var MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MONTH_NAMES2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function MonthView({ events, activeDate, onDayClick, onNavigate, onGoToYear, renderEvent, theme }) {
  const c = chromeColors(theme);
  const accent = accentColors(theme);
  const todayTint = `color-mix(in srgb, ${c.zebra} 45%, transparent)`;
  const cellBorder = `1px solid ${c.subtle}`;
  const gridBorder = `1px solid color-mix(in srgb, ${c.subtle} 60%, ${c.canvas})`;
  const navButton = {
    background: "none",
    border: cellBorder,
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    color: "inherit"
  };
  const year = parseInt(activeDate.slice(0, 4), 10);
  const month = parseInt(activeDate.slice(5, 7), 10);
  const days = daysInMonth(year, month);
  const startDay = startDayOfWeek(year, month);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const todayYear = parseInt(today.slice(0, 4), 10);
  const [pickerOpen, setPickerOpen] = useState6(false);
  const [pickerYear, setPickerYear] = useState6(year);
  const [hoveredIso, setHoveredIso] = useState6(null);
  const pickerRef = useRef(null);
  useEffect5(() => {
    if (!pickerOpen) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);
  const prevMonth = () => {
    if (month === 1) onNavigate(isoDate(year - 1, 12, 1));
    else onNavigate(isoDate(year, month - 1, 1));
  };
  const nextMonth = () => {
    if (month === 12) onNavigate(isoDate(year + 1, 1, 1));
    else onNavigate(isoDate(year, month + 1, 1));
  };
  const selectMonth = (m) => {
    onNavigate(isoDate(pickerYear, m, 1));
    setPickerOpen(false);
  };
  const cells = [
    ...Array(startDay).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1)
  ];
  return /* @__PURE__ */ jsxs8("div", { style: { fontFamily: "inherit", position: "relative" }, children: [
    /* @__PURE__ */ jsxs8("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, children: [
      /* @__PURE__ */ jsx10("button", { "aria-label": "Previous month", onClick: prevMonth, style: navButton, children: "\u2039" }),
      /* @__PURE__ */ jsx10(
        CrumbTrail,
        {
          theme,
          crumbs: [
            { label: String(year), onClick: onGoToYear },
            {
              // The current crumb doubles as the picker trigger: it is where you
              // already are, so it opens the way to a sibling rather than an ancestor.
              label: /* @__PURE__ */ jsxs8(Fragment2, { children: [
                monthName(month),
                /* @__PURE__ */ jsx10("span", { "aria-hidden": true, style: { fontSize: 9, color: c.mutedText }, children: pickerOpen ? "\u25B2" : "\u25BC" })
              ] }),
              name: `${monthName(month)} \u2014 open month picker`,
              onClick: () => {
                setPickerYear(year);
                setPickerOpen((v) => !v);
              }
            }
          ]
        }
      ),
      /* @__PURE__ */ jsx10("button", { "aria-label": "Next month", onClick: nextMonth, style: navButton, children: "\u203A" })
    ] }),
    pickerOpen && /* @__PURE__ */ jsxs8("div", { ref: pickerRef, style: { position: "absolute", top: 36, left: "50%", transform: "translateX(-50%)", zIndex: 10, background: c.panel, border: cellBorder, borderRadius: 8, padding: 10, minWidth: 200 }, children: [
      /* @__PURE__ */ jsxs8("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, children: [
        /* @__PURE__ */ jsx10("button", { "aria-label": "Previous year", onClick: () => setPickerYear((y) => y - 1), style: { background: "none", border: cellBorder, borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "inherit", fontSize: 12 }, children: "\u2039" }),
        /* @__PURE__ */ jsx10("span", { "aria-label": "Picker year", style: { fontWeight: 700, fontSize: 13 }, children: pickerYear }),
        /* @__PURE__ */ jsx10(
          "button",
          {
            "aria-label": "Next year",
            onClick: () => setPickerYear((y) => y + 1),
            disabled: pickerYear >= todayYear,
            style: { background: "none", border: cellBorder, borderRadius: 4, padding: "2px 8px", cursor: pickerYear >= todayYear ? "not-allowed" : "pointer", color: pickerYear >= todayYear ? c.faintText : "inherit", fontSize: 12 },
            children: "\u203A"
          }
        )
      ] }),
      /* @__PURE__ */ jsx10("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }, children: MONTH_ABBRS.map((abbr, i) => {
        const m = i + 1;
        const isSelected = pickerYear === year && m === month;
        const isFuture = pickerYear === todayYear && m > parseInt(today.slice(5, 7), 10);
        return /* @__PURE__ */ jsx10(
          "button",
          {
            "aria-label": `Select ${MONTH_NAMES2[i]}`,
            onClick: () => !isFuture && selectMonth(m),
            disabled: isFuture,
            style: {
              background: isSelected ? c.zebra : "none",
              border: isSelected ? `1px solid ${accent.border}` : "1px solid transparent",
              borderRadius: 5,
              color: isSelected ? accent.text : isFuture ? c.faintText : "inherit",
              cursor: isFuture ? "not-allowed" : "pointer",
              padding: "5px 4px",
              fontSize: 11,
              fontWeight: isSelected ? 600 : 400
            },
            children: abbr
          },
          abbr
        );
      }) })
    ] }),
    /* @__PURE__ */ jsxs8("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: 11, borderTop: gridBorder, borderLeft: gridBorder }, children: [
      WEEKDAYS.map((d) => /* @__PURE__ */ jsx10("div", { style: { color: c.faintText, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", padding: "4px 0", borderRight: gridBorder, borderBottom: gridBorder }, children: d }, d)),
      cells.map((day, i) => {
        if (day === null) return /* @__PURE__ */ jsx10("div", { style: { borderRight: gridBorder, borderBottom: gridBorder } }, `empty-${i}`);
        const iso = isoDate(year, month, day);
        const dayEvents = eventsForDate(events, iso);
        const isToday = iso === today;
        const isHovered = iso === hoveredIso;
        const visibleDots = dayEvents.slice(0, 3);
        const overflow = dayEvents.length - 3;
        return /* @__PURE__ */ jsxs8(
          "div",
          {
            onClick: () => onDayClick(iso, dayEvents),
            onMouseEnter: () => setHoveredIso(iso),
            onMouseLeave: () => setHoveredIso((prev) => prev === iso ? null : prev),
            style: {
              padding: "4px 2px",
              borderRight: gridBorder,
              borderBottom: gridBorder,
              background: isHovered ? c.zebra : isToday ? todayTint : void 0,
              cursor: "pointer",
              minHeight: 96,
              transition: "background 0.12s ease"
            },
            children: [
              /* @__PURE__ */ jsx10("div", { style: { fontSize: 11, color: c.mutedText, fontWeight: isToday ? 700 : 400 }, children: day }),
              /* @__PURE__ */ jsxs8("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
                visibleDots.map(
                  (e, j) => renderEvent ? /* @__PURE__ */ jsx10("div", { children: renderEvent(e) }, j) : /* @__PURE__ */ jsx10("span", { "data-testid": "event-dot", style: { color: e.color, fontSize: 8, textAlign: "center" }, children: "\u25CF" }, j)
                ),
                overflow > 0 && /* @__PURE__ */ jsxs8("span", { style: { fontSize: 8, color: c.mutedText, textAlign: "center" }, children: [
                  "+",
                  overflow
                ] })
              ] })
            ]
          },
          iso
        );
      })
    ] })
  ] });
}

// src/components/Calendar/WeekView.tsx
import { jsx as jsx11, jsxs as jsxs9 } from "react/jsx-runtime";
var SHORT_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function WeekView({ events, activeDate, onDayClick, onNavigate, onGoToMonth, onGoToYear, theme }) {
  const c = chromeColors(theme);
  const weekStart = startOfWeek(activeDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const startLabel = days[0].slice(8).replace(/^0/, "");
  const endLabel = days[6].slice(8).replace(/^0/, "");
  const year = parseInt(days[0].slice(0, 4), 10);
  const monthNumber = parseInt(days[0].slice(5, 7), 10);
  const navButton = {
    background: "none",
    border: `1px solid ${c.subtle}`,
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    color: "inherit"
  };
  return /* @__PURE__ */ jsxs9("div", { style: { fontFamily: "inherit" }, children: [
    /* @__PURE__ */ jsxs9("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, children: [
      /* @__PURE__ */ jsx11("button", { "aria-label": "Previous week", onClick: () => onNavigate(addDays(activeDate, -7)), style: navButton, children: "\u2039" }),
      /* @__PURE__ */ jsx11(
        CrumbTrail,
        {
          theme,
          crumbs: [
            { label: String(year), onClick: onGoToYear },
            { label: monthName(monthNumber), onClick: onGoToMonth },
            { label: `${startLabel}\u2013${endLabel}` }
          ]
        }
      ),
      /* @__PURE__ */ jsx11("button", { "aria-label": "Next week", onClick: () => onNavigate(addDays(weekStart, 7)), style: navButton, children: "\u203A" })
    ] }),
    /* @__PURE__ */ jsx11("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 11 }, children: days.map((iso, i) => {
      const day = parseInt(iso.slice(8), 10);
      const dayEvents = eventsForDate(events, iso);
      return /* @__PURE__ */ jsxs9("div", { style: { background: c.panel, borderRadius: 6, padding: 8, minHeight: 80 }, children: [
        /* @__PURE__ */ jsxs9("div", { style: { color: c.mutedText, marginBottom: 4, textAlign: "center" }, children: [
          /* @__PURE__ */ jsx11("span", { children: SHORT_DAYS[i] }),
          " ",
          /* @__PURE__ */ jsx11("span", { children: day })
        ] }),
        /* @__PURE__ */ jsx11("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: dayEvents.map((e) => /* @__PURE__ */ jsx11(
          "div",
          {
            onClick: () => onDayClick(iso, dayEvents),
            style: {
              background: `${e.color}22`,
              borderLeft: `2px solid ${e.color}`,
              padding: "2px 4px",
              borderRadius: 2,
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            },
            children: e.title
          },
          e.id
        )) })
      ] }, iso);
    }) })
  ] });
}

// src/components/Calendar/Calendar.tsx
import { jsx as jsx12 } from "react/jsx-runtime";
function Calendar({ events, defaultView = "month", defaultDate, onDayClick, renderEvent, theme }) {
  const hostTheme = useDarkClass();
  const resolved = theme ?? hostTheme;
  const [view, setView] = useState7(defaultView);
  const [activeDate, setActiveDate] = useState7(defaultDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  const handleMonthClick = (iso) => {
    setActiveDate(iso);
    setView("month");
  };
  const handleDayClick = (date, dayEvents) => {
    if (onDayClick) {
      onDayClick(date, dayEvents);
    } else {
      setActiveDate(startOfWeek(date));
      setView("week");
    }
  };
  if (view === "year") {
    return /* @__PURE__ */ jsx12(
      YearView,
      {
        events,
        activeDate,
        onMonthClick: handleMonthClick,
        onNavigate: setActiveDate,
        theme: resolved
      }
    );
  }
  if (view === "week") {
    return /* @__PURE__ */ jsx12(
      WeekView,
      {
        events,
        activeDate,
        onDayClick: handleDayClick,
        onNavigate: setActiveDate,
        onGoToMonth: () => setView("month"),
        onGoToYear: () => setView("year"),
        theme: resolved
      }
    );
  }
  return /* @__PURE__ */ jsx12(
    MonthView,
    {
      events,
      activeDate,
      onDayClick: handleDayClick,
      onNavigate: setActiveDate,
      onGoToYear: () => setView("year"),
      renderEvent,
      theme: resolved
    }
  );
}

// src/shell/ZoomIndicator.tsx
import { useRef as useRef3, useState as useState9 } from "react";

// src/shell/useZoomFactor.ts
import { useEffect as useEffect6, useState as useState8 } from "react";
var ZOOM_NEUTRAL = 1;
function useZoomNeutral(zoom) {
  const [resolved, setResolved] = useState8(null);
  useEffect6(() => {
    if (!zoom?.neutral) return;
    let cancelled = false;
    void zoom.neutral().then((n) => {
      if (!cancelled) setResolved(n);
    });
    return () => {
      cancelled = true;
    };
  }, [zoom]);
  if (!zoom) return null;
  if (!zoom.neutral) return ZOOM_NEUTRAL;
  return resolved;
}
function useAppBarZoomVar(zoom) {
  useEffect6(() => {
    if (!zoom) return;
    const root = document.documentElement;
    const write = (f) => root.style.setProperty("--ds-page-factor", String(f));
    let cancelled = false;
    void zoom.get().then((f) => {
      if (!cancelled) write(f);
    });
    void zoom.neutral?.().then((n) => {
      if (!cancelled) root.style.setProperty("--ds-zoom-neutral", String(n));
    });
    const unsub = zoom.onChange(write);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [zoom]);
}
function useZoomFactor(zoom) {
  const [factor, setFactor] = useState8(ZOOM_NEUTRAL);
  useEffect6(() => {
    if (!zoom) return;
    let cancelled = false;
    void zoom.get().then((f) => {
      if (!cancelled) setFactor(f);
    });
    const unsub = zoom.onChange(setFactor);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [zoom]);
  return zoom ? factor : 1;
}

// src/shell/useDismiss.ts
import { useEffect as useEffect7, useRef as useRef2 } from "react";
function useDismiss(open, ref, close) {
  const closeRef = useRef2(close);
  useEffect7(() => {
    closeRef.current = close;
  });
  useEffect7(() => {
    if (!open) return;
    const dismiss = () => closeRef.current();
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) dismiss();
    };
    const onKey = (e) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", dismiss);
    };
  }, [open, ref]);
}

// src/shell/ZoomIndicator.tsx
import { jsx as jsx13, jsxs as jsxs10 } from "react/jsx-runtime";
function Magnifier({ sign }) {
  return /* @__PURE__ */ jsxs10("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", "data-zoom": sign, children: [
    /* @__PURE__ */ jsx13("circle", { cx: "6.5", cy: "6.5", r: "4.5", fill: "none", stroke: "currentColor", strokeWidth: "1.5" }),
    /* @__PURE__ */ jsx13(
      "line",
      {
        x1: "10",
        y1: "10",
        x2: "14.5",
        y2: "14.5",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round"
      }
    ),
    /* @__PURE__ */ jsx13(
      "line",
      {
        x1: "4",
        y1: "6.5",
        x2: "9",
        y2: "6.5",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round"
      }
    ),
    sign === "plus" && /* @__PURE__ */ jsx13(
      "line",
      {
        x1: "6.5",
        y1: "4",
        x2: "6.5",
        y2: "9",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round"
      }
    )
  ] });
}
function ZoomIndicator({ bridge }) {
  const zoom = bridge.zoom;
  const factor = useZoomFactor(zoom);
  const neutral = useZoomNeutral(zoom);
  const [open, setOpen] = useState9(false);
  const ref = useRef3(null);
  const pct = Math.round(factor * 100);
  const atNeutral = neutral === null || pct === Math.round(neutral * 100);
  const [wasNeutral, setWasNeutral] = useState9(atNeutral);
  if (atNeutral !== wasNeutral) {
    setWasNeutral(atNeutral);
    if (atNeutral && open) setOpen(false);
  }
  useDismiss(open, ref, () => setOpen(false));
  if (!zoom) return null;
  return /* @__PURE__ */ jsxs10(
    "div",
    {
      className: "ds-zoom",
      ref,
      style: atNeutral ? { visibility: "hidden", pointerEvents: "none" } : void 0,
      children: [
        /* @__PURE__ */ jsx13(
          "button",
          {
            className: "ds-appbar-btn ds-zoom-icon",
            title: `Zoom: ${pct}%`,
            onClick: () => setOpen((o) => !o),
            tabIndex: atNeutral ? -1 : void 0,
            "aria-hidden": atNeutral || void 0,
            children: /* @__PURE__ */ jsx13(Magnifier, { sign: factor > (neutral ?? factor) ? "plus" : "minus" })
          }
        ),
        open && !atNeutral && /* @__PURE__ */ jsxs10("div", { className: "ds-zoom-pop", children: [
          /* @__PURE__ */ jsxs10("span", { className: "ds-zoom-pct", children: [
            pct,
            "%"
          ] }),
          /* @__PURE__ */ jsx13("button", { className: "ds-zoom-step", title: "Zoom out", onClick: () => zoom.out(), children: "\u2212" }),
          /* @__PURE__ */ jsx13("button", { className: "ds-zoom-step", title: "Zoom in", onClick: () => zoom.in(), children: "+" }),
          /* @__PURE__ */ jsx13("button", { className: "ds-zoom-reset", title: "Reset to default", onClick: () => zoom.reset(), children: "Reset" })
        ] })
      ]
    }
  );
}

// src/shell/useMaximized.ts
import { useEffect as useEffect8, useState as useState10 } from "react";
function useMaximized(bridge) {
  const [maximized, setMaximized] = useState10(false);
  useEffect8(() => {
    if (!bridge?.onMaximizeChange && !bridge?.isMaximized) return;
    let alive = true;
    void bridge.isMaximized?.().then((value) => {
      if (alive) setMaximized(value);
    });
    const off = bridge.onMaximizeChange?.((value) => {
      if (alive) setMaximized(value);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [bridge]);
  return maximized;
}

// src/shell/OverflowMenu.tsx
import { useRef as useRef4, useState as useState14 } from "react";

// src/shell/theme.ts
import { useState as useState11, useCallback as useCallback2 } from "react";
var KEY = "ds-theme";
function getSavedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}
function resolveInitialTheme() {
  const saved = getSavedTheme();
  if (saved) return saved;
  try {
    if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
  }
  return "dark";
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
}
function useTheme2() {
  const [theme, setTheme] = useState11(
    () => document.documentElement.dataset.theme || resolveInitialTheme()
  );
  const toggle = useCallback2(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

// src/shell/ThemeToggle.tsx
import { jsx as jsx14, jsxs as jsxs11 } from "react/jsx-runtime";
var ICON = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
function ThemeIcon({ theme }) {
  return theme === "dark" ? /* @__PURE__ */ jsxs11("svg", { ...ICON, "data-icon": "sun", children: [
    /* @__PURE__ */ jsx14("circle", { cx: "12", cy: "12", r: "4" }),
    /* @__PURE__ */ jsx14("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" })
  ] }) : /* @__PURE__ */ jsx14("svg", { ...ICON, "data-icon": "moon", children: /* @__PURE__ */ jsx14("path", { d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" }) });
}
function ThemeToggle({ theme, onToggle, className = "ds-appbar-btn" }) {
  const [ownTheme, ownToggle] = useTheme2();
  const current = theme ?? ownTheme;
  const toggle = onToggle ?? ownToggle;
  return /* @__PURE__ */ jsx14(
    "button",
    {
      className,
      title: current === "dark" ? "Switch to light theme" : "Switch to dark theme",
      onClick: toggle,
      children: /* @__PURE__ */ jsx14(ThemeIcon, { theme: current })
    }
  );
}

// src/shell/useFullscreen.ts
import { useEffect as useEffect9, useState as useState12 } from "react";
function useFullscreen(bridge) {
  const [fullscreen, setFullscreen] = useState12(false);
  useEffect9(() => {
    const api = bridge?.fullscreen;
    if (!api) return;
    let alive = true;
    void api.isFullscreen().then((value) => {
      if (alive) setFullscreen(value);
    });
    const off = api.onFullscreenChange((value) => {
      if (alive) setFullscreen(value);
    });
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);
  return fullscreen;
}

// src/shell/ThemePicker.tsx
import { useState as useState13 } from "react";

// src/shell/WindowGlyphs.tsx
import { jsx as jsx15, jsxs as jsxs12 } from "react/jsx-runtime";
var BOX = { viewBox: "0 0 10 10", fill: "none", stroke: "currentColor" };
function MaximizeGlyph() {
  return /* @__PURE__ */ jsx15("svg", { ...BOX, width: "10", height: "10", "data-icon": "maximize", "aria-hidden": "true", children: /* @__PURE__ */ jsx15("rect", { x: "0.5", y: "0.5", width: "9", height: "9" }) });
}
function RestoreGlyph() {
  return /* @__PURE__ */ jsxs12("svg", { ...BOX, width: "10", height: "10", "data-icon": "restore", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx15("rect", { x: "0.5", y: "2.5", width: "7", height: "7" }),
    /* @__PURE__ */ jsx15("path", { d: "M2.5 2.5V0.5H9.5V7.5H7.5" })
  ] });
}
function FullscreenGlyph() {
  return /* @__PURE__ */ jsx15(
    "svg",
    {
      ...BOX,
      width: "12",
      height: "12",
      strokeWidth: "1.2",
      strokeLinecap: "round",
      "data-icon": "fullscreen",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx15("path", { d: "M0.8 3.4V0.8H3.4M6.6 0.8H9.2V3.4M9.2 6.6V9.2H6.6M3.4 9.2H0.8V6.6" })
    }
  );
}
function CheckGlyph() {
  return /* @__PURE__ */ jsx15(
    "svg",
    {
      ...BOX,
      width: "10",
      height: "10",
      strokeWidth: "1.6",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "data-icon": "check",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx15("path", { d: "M1.5 5.5L4 8L8.5 2.5" })
    }
  );
}

// src/shell/ThemePicker.tsx
import { jsx as jsx16, jsxs as jsxs13 } from "react/jsx-runtime";
function Swatch({ theme }) {
  const bg = theme.colors["--ds-bg"] ?? (theme.type === "dark" ? "#0d1117" : "#ffffff");
  const accent = theme.colors["--ds-accent"] ?? (theme.type === "dark" ? "#58a6ff" : "#0969da");
  const border = theme.colors["--ds-border"] ?? (theme.type === "dark" ? "#30363d" : "#d1d9e0");
  return /* @__PURE__ */ jsx16("span", { className: "ds-theme-swatch", style: { background: bg, borderColor: border }, children: /* @__PURE__ */ jsx16("span", { style: { background: accent } }) });
}
var GROUP_LABEL = { dark: "Dark", light: "Light" };
function ThemePicker({
  registry,
  onPicked
}) {
  const [open, setOpen] = useState13(false);
  const { themes, theme, select } = registry;
  const groups = ["dark", "light"];
  return /* @__PURE__ */ jsxs13(
    "div",
    {
      className: "ds-submenu",
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      children: [
        /* @__PURE__ */ jsxs13(
          "button",
          {
            className: "ds-menu-item",
            role: "menuitem",
            "aria-haspopup": "menu",
            "aria-expanded": open,
            onClick: () => setOpen((o) => !o),
            children: [
              /* @__PURE__ */ jsx16(ThemeIcon, { theme: theme.type }),
              /* @__PURE__ */ jsx16("span", { className: "ds-menu-label", children: "Theme" }),
              /* @__PURE__ */ jsx16("span", { className: "ds-submenu-arrow", "aria-hidden": "true", children: "\u2039" })
            ]
          }
        ),
        open && /* @__PURE__ */ jsx16("div", { className: "ds-submenu-panel scroll-slim", role: "menu", children: groups.map((type) => {
          const inGroup = themes.filter((t) => t.type === type);
          if (!inGroup.length) return null;
          return /* @__PURE__ */ jsxs13("div", { role: "group", "aria-label": GROUP_LABEL[type], children: [
            /* @__PURE__ */ jsx16("div", { className: "ds-menu-heading", children: GROUP_LABEL[type] }),
            inGroup.map((t) => /* @__PURE__ */ jsxs13(
              "button",
              {
                className: "ds-menu-item",
                role: "menuitemradio",
                "aria-checked": t.id === theme.id,
                onClick: () => {
                  select(t.id);
                  setOpen(false);
                  onPicked?.();
                },
                children: [
                  /* @__PURE__ */ jsx16(Swatch, { theme: t }),
                  /* @__PURE__ */ jsx16("span", { className: "ds-menu-label", children: t.label }),
                  /* @__PURE__ */ jsx16("span", { className: "ds-menu-check", children: t.id === theme.id && /* @__PURE__ */ jsx16(CheckGlyph, {}) })
                ]
              },
              t.id
            ))
          ] }, type);
        }) })
      ]
    }
  );
}

// src/shell/OverflowMenu.tsx
import { jsx as jsx17, jsxs as jsxs14 } from "react/jsx-runtime";
function OverflowMenu({ theme, onToggle, bridge, themes, items }) {
  const [open, setOpen] = useState14(false);
  const ref = useRef4(null);
  const [ownTheme, ownToggle] = useTheme2();
  const current = theme ?? ownTheme;
  const toggleTheme = onToggle ?? ownToggle;
  const fullscreen = useFullscreen(bridge);
  const fullscreenApi = bridge?.fullscreen;
  useDismiss(open, ref, () => setOpen(false));
  return /* @__PURE__ */ jsxs14("div", { className: "ds-menu", ref, children: [
    /* @__PURE__ */ jsx17(
      "button",
      {
        className: "ds-appbar-btn",
        title: "More options",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((o) => !o),
        children: "\u22EF"
      }
    ),
    open && /* @__PURE__ */ jsxs14("div", { className: "ds-menu-panel", role: "menu", children: [
      items?.map((item) => /* @__PURE__ */ jsxs14(
        "button",
        {
          className: "ds-menu-item",
          role: "menuitem",
          onClick: () => {
            item.onSelect();
            setOpen(false);
          },
          children: [
            /* @__PURE__ */ jsx17("span", { className: "ds-menu-icon", children: item.icon }),
            /* @__PURE__ */ jsx17("span", { className: "ds-menu-label", children: item.label })
          ]
        },
        item.label
      )),
      themes ? /* @__PURE__ */ jsx17(ThemePicker, { registry: themes, onPicked: () => setOpen(false) }) : /* @__PURE__ */ jsxs14(
        "button",
        {
          className: "ds-menu-item",
          role: "menuitem",
          onClick: () => {
            toggleTheme();
            setOpen(false);
          },
          children: [
            /* @__PURE__ */ jsx17(ThemeIcon, { theme: current }),
            /* @__PURE__ */ jsx17("span", { className: "ds-menu-label", children: current === "dark" ? "Light theme" : "Dark theme" })
          ]
        }
      ),
      fullscreenApi && /* @__PURE__ */ jsxs14(
        "button",
        {
          className: "ds-menu-item",
          role: "menuitem",
          onClick: () => {
            fullscreenApi.toggle();
            setOpen(false);
          },
          children: [
            /* @__PURE__ */ jsx17(FullscreenGlyph, {}),
            /* @__PURE__ */ jsx17("span", { className: "ds-menu-label", children: "Full screen" }),
            /* @__PURE__ */ jsx17("span", { className: "ds-menu-check", children: fullscreen && /* @__PURE__ */ jsx17(CheckGlyph, {}) })
          ]
        }
      )
    ] })
  ] });
}

// src/shell/themes/builtins.ts
var githubDark = {
  id: "github-dark",
  label: "GitHub Dark",
  type: "dark",
  // Empty: this IS the dark base. Named explicitly anyway so the picker can show
  // it as a choice and so the persisted selection has a real id to point at.
  colors: {},
  sortOrder: 0,
  builtin: true
};
var githubLight = {
  id: "github-light",
  label: "GitHub Light",
  type: "light",
  colors: {},
  sortOrder: 1,
  builtin: true
};
var monokai = {
  id: "monokai",
  label: "Monokai",
  type: "dark",
  colors: {
    "--ds-bg": "#272822",
    "--ds-surface": "#2f302a",
    "--ds-border": "#49483e",
    "--ds-border-dim": "#3a3b34",
    "--ds-text": "#f8f8f2",
    "--ds-muted": "#b0aa96",
    // published comment gray #75715e is ~3.0:1 here
    "--ds-accent": "#a6e22e",
    "--ds-scroll-thumb": "#4a4b42",
    "--ds-scroll-thumb-hover": "#61625a",
    "--ds-sel-bg": "#49483e",
    "--ds-sel-fg": "#f8f8f2",
    "--ds-ok-bg": "#1e2a15",
    "--ds-ok-fg": "#a6e22e",
    "--ds-warn-bg": "#332b16",
    "--ds-warn-fg": "#e6db74",
    // Fill darkened from #33191d so Monokai's signature #f92672 clears 4.5:1 on
    // it. Darkening the fill rather than lightening the pink: the pink IS the
    // palette, the fill behind it is not.
    "--ds-err-bg": "#2b1519",
    "--ds-err-fg": "#f92672",
    "--ds-danger-bg": "#4a1622",
    "--ds-danger-fg": "#fd9bb8",
    "--ansi-bg": "#272822",
    "--ansi-fg": "#f8f8f2",
    "--ansi-red": "#f92672",
    "--ansi-green": "#a6e22e",
    "--ansi-yellow": "#e6db74",
    "--ansi-blue": "#66d9ef",
    "--ansi-magenta": "#ae81ff",
    "--ansi-cyan": "#66d9ef",
    "--ansi-bright-red": "#f92672",
    "--ansi-bright-green": "#a6e22e",
    "--ansi-bright-yellow": "#e6db74",
    "--ansi-bright-blue": "#66d9ef",
    "--ansi-bright-magenta": "#ae81ff",
    "--ansi-bright-cyan": "#66d9ef"
  },
  sortOrder: 10,
  builtin: true
};
var dracula = {
  id: "dracula",
  label: "Dracula",
  type: "dark",
  colors: {
    "--ds-bg": "#282a36",
    "--ds-surface": "#343746",
    "--ds-border": "#44475a",
    "--ds-border-dim": "#343746",
    "--ds-text": "#f8f8f2",
    "--ds-muted": "#a3a8c3",
    // published #6272a4 is ~3.1:1 on this background
    "--ds-accent": "#bd93f9",
    "--ds-scroll-thumb": "#454858",
    "--ds-scroll-thumb-hover": "#5b5f73",
    "--ds-sel-bg": "#44475a",
    "--ds-sel-fg": "#f8f8f2",
    "--ds-ok-bg": "#1d3026",
    "--ds-ok-fg": "#50fa7b",
    "--ds-warn-bg": "#3a3320",
    "--ds-warn-fg": "#f1fa8c",
    "--ds-err-bg": "#3a1f27",
    "--ds-err-fg": "#ff79c6",
    "--ds-danger-bg": "#4a1f24",
    "--ds-danger-fg": "#ff6e6e",
    "--ansi-bg": "#282a36",
    "--ansi-fg": "#f8f8f2",
    "--ansi-red": "#ff5555",
    "--ansi-green": "#50fa7b",
    "--ansi-yellow": "#f1fa8c",
    "--ansi-blue": "#bd93f9",
    "--ansi-magenta": "#ff79c6",
    "--ansi-cyan": "#8be9fd",
    "--ansi-bright-red": "#ff6e6e",
    "--ansi-bright-green": "#69ff94",
    "--ansi-bright-yellow": "#ffffa5",
    "--ansi-bright-blue": "#d6acff",
    "--ansi-bright-magenta": "#ff92df",
    "--ansi-bright-cyan": "#a4ffff"
  },
  sortOrder: 11,
  builtin: true
};
var nord = {
  id: "nord",
  label: "Nord",
  type: "dark",
  colors: {
    "--ds-bg": "#2e3440",
    "--ds-surface": "#3b4252",
    "--ds-border": "#4c566a",
    "--ds-border-dim": "#3b4252",
    "--ds-text": "#eceff4",
    "--ds-muted": "#aab3c4",
    // published nord3 #4c566a is ~2.4:1 — unusable as text
    "--ds-accent": "#88c0d0",
    "--ds-scroll-thumb": "#4a5364",
    "--ds-scroll-thumb-hover": "#606b80",
    "--ds-sel-bg": "#434c5e",
    "--ds-sel-fg": "#eceff4",
    "--ds-ok-bg": "#26332c",
    "--ds-ok-fg": "#a3be8c",
    "--ds-warn-bg": "#3a3529",
    "--ds-warn-fg": "#ebcb8b",
    "--ds-err-bg": "#3a2a2d",
    // nord11 (#bf616a) lightened: it measures 3.3:1 on this fill, and the fill
    // cannot go dark enough to fix it without falling far below Nord's other
    // fills — the palette's whole character is mid-tone, so the fix goes on the
    // foreground here where Monokai's went on the background.
    "--ds-err-fg": "#cc8188",
    "--ds-danger-bg": "#442b2f",
    "--ds-danger-fg": "#d08770",
    "--ansi-bg": "#2e3440",
    "--ansi-fg": "#d8dee9",
    "--ansi-red": "#bf616a",
    "--ansi-green": "#a3be8c",
    "--ansi-yellow": "#ebcb8b",
    "--ansi-blue": "#81a1c1",
    "--ansi-magenta": "#b48ead",
    "--ansi-cyan": "#88c0d0",
    "--ansi-bright-red": "#bf616a",
    "--ansi-bright-green": "#a3be8c",
    "--ansi-bright-yellow": "#ebcb8b",
    "--ansi-bright-blue": "#81a1c1",
    "--ansi-bright-magenta": "#b48ead",
    "--ansi-bright-cyan": "#8fbcbb"
  },
  sortOrder: 12,
  builtin: true
};
var solarizedLight = {
  id: "solarized-light",
  label: "Solarized Light",
  type: "light",
  colors: {
    "--ds-bg": "#fdf6e3",
    "--ds-surface": "#eee8d5",
    "--ds-border": "#d3cbb7",
    "--ds-border-dim": "#e8e1cd",
    "--ds-text": "#073642",
    // base01 territory rather than base00 (#657b83): the published value clears
    // 4.5:1 on the background but only 4.0:1 on the surface, and this token paints
    // on both. Picked to clear the floor against the surface, the harder of the two.
    "--ds-muted": "#4e6568",
    // Solarized blue #268bd2 is 3.4:1 on base3 — designed as a syntax color on a
    // large type ramp, not as 12px UI text. Darkened one step to clear AA.
    "--ds-accent": "#2076b3",
    "--ds-scroll-thumb": "#d9d2bd",
    "--ds-scroll-thumb-hover": "#c4bca6",
    "--ds-sel-bg": "#e3ecd8",
    "--ds-sel-fg": "#073642",
    "--ds-ok-bg": "#e8eed4",
    "--ds-ok-fg": "#5b7300",
    "--ds-warn-bg": "#f7ecd0",
    "--ds-warn-fg": "#876600",
    "--ds-err-bg": "#f7dfd8",
    "--ds-err-fg": "#ba2f17",
    // one step down from Solarized red; #c1341a is 4.37:1 here
    "--ds-danger-bg": "#f2d5d0",
    "--ds-danger-fg": "#b0281a",
    "--ansi-bg": "#fdf6e3",
    "--ansi-fg": "#073642",
    "--ansi-red": "#c1341a",
    "--ansi-green": "#5b7300",
    "--ansi-yellow": "#8a6800",
    "--ansi-blue": "#268bd2",
    "--ansi-magenta": "#c4227c",
    "--ansi-cyan": "#227d78",
    "--ansi-bright-red": "#c1341a",
    "--ansi-bright-green": "#5b7300",
    "--ansi-bright-yellow": "#8a6800",
    "--ansi-bright-blue": "#268bd2",
    "--ansi-bright-magenta": "#c4227c",
    "--ansi-bright-cyan": "#227d78"
  },
  sortOrder: 13,
  builtin: true
};
var BUILTIN_THEMES = [
  githubDark,
  githubLight,
  monokai,
  dracula,
  nord,
  solarizedLight
];
var DEFAULT_THEME_ID = "github-dark";

// src/shell/themes/index.ts
import { BASE as BASE2 } from "@devkit-inc/theme-tokens";
import {
  ALL_TOKENS as ALL_TOKENS2,
  ANSI_TOKENS,
  CHROME_TOKENS as CHROME_TOKENS2,
  HUE_NAMES,
  HUE_TOKENS,
  OPTIONAL_TOKENS,
  SEMANTIC_TOKENS,
  isThemeToken as isThemeToken2
} from "@devkit-inc/theme-tokens";

// src/shell/themes/types.ts
import { isThemeToken } from "@devkit-inc/theme-tokens";
function parseThemeRow(row) {
  if (typeof row?.id !== "string" || !row.id) return null;
  if (row.type !== "light" && row.type !== "dark") return null;
  const colors = {};
  if (row.colors && typeof row.colors === "object" && !Array.isArray(row.colors)) {
    for (const [key, value] of Object.entries(row.colors)) {
      if (typeof value === "string" && value && isThemeToken(key)) colors[key] = value;
    }
  }
  return {
    id: row.id,
    label: typeof row.label === "string" && row.label ? row.label : row.id,
    type: row.type,
    colors,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 100
  };
}

// src/shell/themes/resolve.ts
import { ALL_TOKENS, BASE } from "@devkit-inc/theme-tokens";
function resolveTheme(theme) {
  const out = { ...BASE[theme.type] };
  for (const [name, value] of Object.entries(theme.colors)) {
    if (typeof value === "string" && value) out[name] = value;
  }
  return out;
}
function applyResolvedTheme(theme, tokens = resolveTheme(theme)) {
  const el = document.documentElement;
  el.dataset.theme = theme.type;
  el.dataset.themeId = theme.id;
  el.classList.toggle("dark", theme.type === "dark");
  el.style.colorScheme = theme.type;
  for (const name of ALL_TOKENS) {
    const value = tokens[name];
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  }
}
function themeToCss(theme, tokens = resolveTheme(theme)) {
  const decls = ALL_TOKENS.filter((n) => tokens[n]).map((n) => `  ${n}: ${tokens[n]};`).join("\n");
  return `:root {
  color-scheme: ${theme.type};
${decls}
}`;
}

// src/shell/themes/registry.ts
function mergeRemoteThemes(rows, appThemes = []) {
  const byId = new Map(
    [...BUILTIN_THEMES, ...appThemes].map((t) => [t.id, { ...t, builtin: true }])
  );
  const builtinIds = new Set(byId.keys());
  for (const row of rows) {
    if (row?.deleted_at) {
      if (!builtinIds.has(row.id)) byId.delete(row.id);
      continue;
    }
    const parsed = parseThemeRow(row);
    if (!parsed) continue;
    byId.set(parsed.id, { ...parsed, builtin: builtinIds.has(parsed.id) });
  }
  return [...byId.values()].sort(
    (a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.label.localeCompare(b.label)
  );
}
function pickTheme(themes, id, defaultId = DEFAULT_THEME_ID) {
  return themes.find((t) => t.id === id) ?? themes.find((t) => t.id === defaultId) ?? themes.find((t) => t.id === DEFAULT_THEME_ID) ?? themes[0] ?? BUILTIN_THEMES[0];
}
function counterpartTheme(themes, current, preferred = {}) {
  const target = current.type === "dark" ? "light" : "dark";
  const remembered = themes.find((t) => t.id === preferred[target] && t.type === target);
  return remembered ?? themes.find((t) => t.type === target) ?? current;
}

// src/shell/themes/store.ts
var ID_KEY = "ds-theme-id";
var LEGACY_KEY = "ds-theme";
var PREFERRED_KEY = "ds-theme-preferred";
var CACHE_KEY = "ds-theme-cache";
var LEGACY_MAP = {
  dark: "github-dark",
  light: "github-light"
};
function loadSelection(storage, defaultId = DEFAULT_THEME_ID) {
  let id = null;
  let preferred = {};
  try {
    id = storage.getItem(ID_KEY);
    if (!id) {
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy && LEGACY_MAP[legacy]) id = LEGACY_MAP[legacy];
    }
    const raw = storage.getItem(PREFERRED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.light === "string") preferred.light = parsed.light;
        if (typeof parsed.dark === "string") preferred.dark = parsed.dark;
      }
    }
  } catch {
    preferred = {};
  }
  return { id: id ?? defaultId, preferred };
}
function saveSelection(storage, selection) {
  try {
    storage.setItem(ID_KEY, selection.id);
    storage.setItem(PREFERRED_KEY, JSON.stringify(selection.preferred));
    storage.setItem(LEGACY_KEY, selection.id.includes("light") ? "light" : "dark");
  } catch {
  }
}
function rememberPreferred(selection, theme) {
  return {
    id: theme.id,
    preferred: { ...selection.preferred, [theme.type]: theme.id }
  };
}
function cacheRows(storage, rows) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
  }
}
function readCachedRows(storage) {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
var PREPAINT_SNIPPET = `(function(){try{var i=localStorage.getItem('${ID_KEY}')||'';var t=localStorage.getItem('${LEGACY_KEY}');var d=t?t:(i.indexOf('light')>=0?'light':'dark');document.documentElement.dataset.theme=d;if(i)document.documentElement.dataset.themeId=i;document.documentElement.classList.toggle('dark',d==='dark');document.documentElement.style.colorScheme=d;}catch(e){}})()`;

// src/shell/themes/useThemeRegistry.ts
import { useCallback as useCallback3, useEffect as useEffect10, useMemo as useMemo2, useRef as useRef5, useState as useState15 } from "react";
function useThemeRegistry(bridge, storage = localStorage, opts = {}) {
  const [rows, setRows] = useState15(() => readCachedRows(storage));
  const [selection, setSelection] = useState15(() => loadSelection(storage, opts.defaultThemeId));
  const [loading, setLoading] = useState15(Boolean(bridge?.list));
  const touched = useRef5(false);
  const themes = useMemo2(() => mergeRemoteThemes(rows, opts.themes), [rows, opts.themes]);
  const theme = useMemo2(
    () => pickTheme(themes, selection.id, opts.defaultThemeId),
    [themes, selection.id, opts.defaultThemeId]
  );
  useEffect10(() => {
    const tokens = resolveTheme(theme);
    applyResolvedTheme(theme, tokens);
    void bridge?.cachePaint?.(themeToCss(theme, tokens))?.catch?.(() => {
    });
  }, [theme, bridge]);
  useEffect10(() => {
    saveSelection(storage, selection);
  }, [storage, selection]);
  useEffect10(() => {
    let live = true;
    void (async () => {
      try {
        const [remoteRows, remoteSelection] = await Promise.all([
          bridge?.list?.() ?? Promise.resolve(null),
          bridge?.getSelection?.() ?? Promise.resolve(null)
        ]);
        if (!live) return;
        if (remoteRows) {
          setRows(remoteRows);
          cacheRows(storage, remoteRows);
        }
        if (remoteSelection?.id && !touched.current) {
          setSelection({ id: remoteSelection.id, preferred: remoteSelection.preferred ?? {} });
        }
      } catch {
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [bridge, storage]);
  const commit = useCallback3(
    (next) => {
      touched.current = true;
      setSelection((prev) => {
        const updated = rememberPreferred(prev, next);
        void bridge?.setSelection?.(updated)?.catch?.(() => {
        });
        return updated;
      });
    },
    [bridge]
  );
  const select = useCallback3(
    (id) => {
      const next = themes.find((t) => t.id === id);
      if (next) commit(next);
    },
    [themes, commit]
  );
  const toggle = useCallback3(() => {
    commit(counterpartTheme(themes, theme, selection.preferred));
  }, [themes, theme, selection.preferred, commit]);
  return { themes, theme, select, toggle, loading };
}

// src/shell/AppBar.tsx
import { Fragment as Fragment3, jsx as jsx18, jsxs as jsxs15 } from "react/jsx-runtime";
function AppBar({
  bridge,
  brand,
  nav = true,
  actions,
  menu = true,
  manageTheme = true,
  menuItems
}) {
  const themes = useThemeRegistry(manageTheme ? bridge?.theme : void 0);
  useAppBarZoomVar(bridge?.zoom);
  const maximized = useMaximized(bridge);
  if (!bridge?.isElectron) return null;
  const label = bridge.isDev ? `${brand} (dev)` : brand;
  return /* @__PURE__ */ jsxs15("div", { className: "ds-appbar", children: [
    /* @__PURE__ */ jsx18("span", { className: "ds-appbar-brand", children: label }),
    nav && /* @__PURE__ */ jsxs15(Fragment3, { children: [
      /* @__PURE__ */ jsx18("button", { className: "ds-appbar-nav", title: "Back", onClick: () => window.history.back(), children: "\u2039" }),
      /* @__PURE__ */ jsx18(
        "button",
        {
          className: "ds-appbar-nav",
          title: "Forward",
          onClick: () => window.history.forward(),
          children: "\u203A"
        }
      )
    ] }),
    actions,
    /* @__PURE__ */ jsx18("span", { className: "ds-appbar-drag" }),
    /* @__PURE__ */ jsx18(ZoomIndicator, { bridge }),
    menu && /* @__PURE__ */ jsx18(OverflowMenu, { bridge, themes: manageTheme ? themes : void 0, items: menuItems }),
    /* @__PURE__ */ jsx18("button", { className: "ds-appbar-btn", title: "Minimize", onClick: () => bridge.minimize(), children: "\u2500" }),
    /* @__PURE__ */ jsx18(
      "button",
      {
        className: "ds-appbar-btn",
        title: maximized ? "Restore" : "Maximize",
        "aria-label": maximized ? "Restore" : "Maximize",
        onClick: () => bridge.maximize(),
        children: maximized ? /* @__PURE__ */ jsx18(RestoreGlyph, {}) : /* @__PURE__ */ jsx18(MaximizeGlyph, {})
      }
    ),
    /* @__PURE__ */ jsx18(
      "button",
      {
        className: "ds-appbar-btn ds-appbar-close",
        title: "Close",
        onClick: () => bridge.close(),
        children: "\u2715"
      }
    )
  ] });
}

// src/shell/VisualZoomViewport.tsx
import { useEffect as useEffect11, useRef as useRef6 } from "react";

// src/shell/visual-zoom.ts
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function clampScale(scale, max) {
  return Math.min(max, Math.max(1, scale));
}
function contentPoint(state, screen) {
  return { x: (screen.x - state.tx) / state.scale, y: (screen.y - state.ty) / state.scale };
}
function applyZoom(anchor, focal, scale) {
  return { scale, tx: focal.x - scale * anchor.x, ty: focal.y - scale * anchor.y };
}
function clampPan(state, content, viewport) {
  const scaledW = content.w * state.scale;
  const scaledH = content.h * state.scale;
  const minTx = Math.min(0, viewport.w - scaledW);
  const minTy = Math.min(0, viewport.h - scaledH);
  return {
    scale: state.scale,
    tx: Math.min(0, Math.max(minTx, state.tx)),
    ty: Math.min(0, Math.max(minTy, state.ty))
  };
}

// src/shell/VisualZoomViewport.tsx
import { jsx as jsx19 } from "react/jsx-runtime";
var TAP_SLOP = 8;
var WHEEL_SENSITIVITY = 0.01;
function VisualZoomViewport({ children, max = 3, className }) {
  const viewportRef = useRef6(null);
  const layerRef = useRef6(null);
  useEffect11(() => {
    const vp = viewportRef.current;
    const layer = layerRef.current;
    if (!vp || !layer) return;
    let st = { scale: 1, tx: 0, ty: 0 };
    let raf = 0;
    let settle = 0;
    const markActive = () => {
      layer.style.willChange = "transform";
      if (settle) clearTimeout(settle);
      settle = window.setTimeout(() => {
        settle = 0;
        layer.style.willChange = "auto";
      }, 180);
    };
    const draw = () => {
      raf = 0;
      layer.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.scale})`;
      markActive();
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const viewport = () => ({ w: vp.clientWidth, h: vp.clientHeight });
    const content = () => ({ w: layer.scrollWidth, h: layer.scrollHeight });
    const origin = (clientX, clientY) => {
      const r = vp.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const commit = (next) => {
      st = next.scale <= 1 ? { scale: 1, tx: 0, ty: 0 } : clampPan(next, content(), viewport());
      schedule();
    };
    let pinchStartDist = 0;
    let pinchStart = st;
    let pinchAnchor = { x: 0, y: 0 };
    let panStart = null;
    let panFrom = st;
    let panning = false;
    const fingerDist = (t) => distance(
      { x: t[0].clientX, y: t[0].clientY },
      { x: t[1].clientX, y: t[1].clientY }
    );
    const centroid = (t) => origin((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = fingerDist(e.touches);
        pinchStart = st;
        pinchAnchor = contentPoint(st, centroid(e.touches));
        panStart = null;
        panning = false;
      } else if (e.touches.length === 1 && st.scale > 1) {
        panStart = origin(e.touches[0].clientX, e.touches[0].clientY);
        panFrom = st;
        panning = false;
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const scale = clampScale(pinchStart.scale * fingerDist(e.touches) / pinchStartDist, max);
        commit(applyZoom(pinchAnchor, centroid(e.touches), scale));
      } else if (e.touches.length === 1 && panStart) {
        const p = origin(e.touches[0].clientX, e.touches[0].clientY);
        if (!panning && Math.hypot(p.x - panStart.x, p.y - panStart.y) < TAP_SLOP) return;
        panning = true;
        e.preventDefault();
        commit({
          scale: panFrom.scale,
          tx: panFrom.tx + (p.x - panStart.x),
          ty: panFrom.ty + (p.y - panStart.y)
        });
      }
    };
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinchStartDist = 0;
      if (e.touches.length === 0) {
        panStart = null;
        panning = false;
      }
    };
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const focal = origin(e.clientX, e.clientY);
        const dy = Math.max(-50, Math.min(50, e.deltaY));
        const scale = clampScale(st.scale * Math.exp(-dy * WHEEL_SENSITIVITY), max);
        commit(applyZoom(contentPoint(st, focal), focal, scale));
      } else if (st.scale > 1) {
        e.preventDefault();
        commit({ scale: st.scale, tx: st.tx - e.deltaX, ty: st.ty - e.deltaY });
      }
    };
    vp.addEventListener("touchstart", onTouchStart, { passive: false });
    vp.addEventListener("touchmove", onTouchMove, { passive: false });
    vp.addEventListener("touchend", onTouchEnd);
    vp.addEventListener("touchcancel", onTouchEnd);
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (settle) clearTimeout(settle);
      vp.removeEventListener("touchstart", onTouchStart);
      vp.removeEventListener("touchmove", onTouchMove);
      vp.removeEventListener("touchend", onTouchEnd);
      vp.removeEventListener("touchcancel", onTouchEnd);
      vp.removeEventListener("wheel", onWheel);
    };
  }, [max]);
  return /* @__PURE__ */ jsx19(
    "div",
    {
      ref: viewportRef,
      className,
      style: {
        flex: "1 1 0%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        touchAction: "pan-x pan-y"
      },
      children: /* @__PURE__ */ jsx19(
        "div",
        {
          ref: layerRef,
          style: {
            flex: "1 1 0%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            transformOrigin: "0 0"
          },
          children
        }
      )
    }
  );
}

// src/shell/BreadcrumbNav.tsx
import { Fragment as Fragment4, useRef as useRef7, useState as useState16 } from "react";
import { jsx as jsx20, jsxs as jsxs16 } from "react/jsx-runtime";
var ICON2 = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
function CrumbIcon({ icon }) {
  return /* @__PURE__ */ jsx20(
    "svg",
    {
      ...ICON2,
      className: "ds-crumb-icon",
      "aria-hidden": "true",
      dangerouslySetInnerHTML: icon ? { __html: icon } : void 0
    }
  );
}
function Arrow({ dir }) {
  return /* @__PURE__ */ jsx20("svg", { ...ICON2, width: 16, height: 16, strokeWidth: 2, children: dir === "back" ? /* @__PURE__ */ jsx20("path", { d: "M15 18l-6-6 6-6" }) : /* @__PURE__ */ jsx20("path", { d: "M9 18l6-6-6-6" }) });
}
function Reload() {
  return /* @__PURE__ */ jsxs16("svg", { ...ICON2, width: 15, height: 15, strokeWidth: 2, children: [
    /* @__PURE__ */ jsx20("path", { d: "M20 11a8 8 0 1 0-2.3 5.7" }),
    /* @__PURE__ */ jsx20("path", { d: "M20 5v6h-6" })
  ] });
}
function CrumbSegment({
  crumb,
  open,
  onToggle,
  onClose
}) {
  const options = (crumb.options ?? []).filter((o) => o.id !== crumb.id);
  const actions = crumb.actions ?? [];
  const hasMenu = options.length > 0 || actions.length > 0;
  const separatedAt = options.findIndex((o) => o.separated);
  const dividerAt = separatedAt > 0 ? separatedAt : -1;
  const label = /* @__PURE__ */ jsx20("span", { className: crumb.brand ? "ds-crumb-brand" : "ds-crumb-label", children: crumb.label });
  return /* @__PURE__ */ jsxs16("div", { className: "ds-crumb", children: [
    hasMenu ? /* @__PURE__ */ jsxs16("button", { className: "ds-crumb-trigger", onClick: onToggle, "aria-haspopup": "menu", "aria-expanded": open, children: [
      /* @__PURE__ */ jsx20(CrumbIcon, { icon: crumb.icon }),
      label,
      /* @__PURE__ */ jsx20("svg", { ...ICON2, width: 10, height: 10, strokeWidth: 2.5, className: "ds-crumb-caret", "data-open": open || void 0, children: /* @__PURE__ */ jsx20("path", { d: "M6 9l6 6 6-6" }) })
    ] }) : /* @__PURE__ */ jsxs16("span", { className: "ds-crumb-trigger", "data-static": "", children: [
      /* @__PURE__ */ jsx20(CrumbIcon, { icon: crumb.icon }),
      label
    ] }),
    open && hasMenu && /* @__PURE__ */ jsxs16("div", { className: "ds-crumb-panel", role: "menu", children: [
      options.map((o, i) => /* @__PURE__ */ jsxs16(Fragment4, { children: [
        i === dividerAt && /* @__PURE__ */ jsx20("div", { className: "ds-crumb-divider" }),
        /* @__PURE__ */ jsxs16(
          "button",
          {
            role: "menuitem",
            className: "ds-crumb-item",
            onClick: () => {
              crumb.onSelect?.(o.id);
              onClose();
            },
            children: [
              /* @__PURE__ */ jsx20(CrumbIcon, { icon: o.icon }),
              /* @__PURE__ */ jsx20("span", { children: o.label })
            ]
          }
        )
      ] }, o.id)),
      options.length > 0 && actions.length > 0 && /* @__PURE__ */ jsx20("div", { className: "ds-crumb-divider" }),
      actions.map((a) => /* @__PURE__ */ jsxs16(
        "button",
        {
          role: "menuitem",
          className: "ds-crumb-item ds-crumb-action",
          onClick: () => {
            a.onSelect();
            onClose();
          },
          children: [
            /* @__PURE__ */ jsx20(CrumbIcon, { icon: a.icon }),
            /* @__PURE__ */ jsx20("span", { children: a.label })
          ]
        },
        a.id
      ))
    ] })
  ] });
}
function BreadcrumbNav({ crumbs, history }) {
  const [openIndex, setOpenIndex] = useState16(null);
  const containerRef = useRef7(null);
  useDismiss(openIndex !== null, containerRef, () => setOpenIndex(null));
  return /* @__PURE__ */ jsxs16("div", { className: "ds-crumbs", ref: containerRef, children: [
    history && /* @__PURE__ */ jsxs16("div", { className: "ds-crumb-history", children: [
      /* @__PURE__ */ jsx20(
        "button",
        {
          className: "ds-crumb-arrow",
          "aria-label": "Back",
          title: "Back",
          disabled: !history.canBack,
          onClick: history.onBack,
          children: /* @__PURE__ */ jsx20(Arrow, { dir: "back" })
        }
      ),
      /* @__PURE__ */ jsx20(
        "button",
        {
          className: "ds-crumb-arrow",
          "aria-label": "Forward",
          title: "Forward",
          disabled: !history.canForward,
          onClick: history.onForward,
          children: /* @__PURE__ */ jsx20(Arrow, { dir: "forward" })
        }
      ),
      history.onReload && /* @__PURE__ */ jsx20("button", { className: "ds-crumb-arrow", "aria-label": "Reload", title: "Reload", onClick: history.onReload, children: /* @__PURE__ */ jsx20(Reload, {}) })
    ] }),
    crumbs.map((crumb, i) => /* @__PURE__ */ jsxs16(Fragment4, { children: [
      i > 0 && /* @__PURE__ */ jsx20("span", { className: "ds-crumb-sep", "aria-hidden": "true", children: "|" }),
      /* @__PURE__ */ jsx20(
        CrumbSegment,
        {
          crumb,
          open: openIndex === i,
          onToggle: () => setOpenIndex((o) => o === i ? null : i),
          onClose: () => setOpenIndex(null)
        }
      )
    ] }, crumb.id))
  ] });
}

// src/components/ConsolePane.tsx
import { useEffect as useEffect12, useRef as useRef8 } from "react";

// src/lib/ansi.ts
var COLORS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
var SGR = new RegExp(String.fromCharCode(27) + "\\[([0-9;]*)m", "g");
function emptyState() {
  return { bold: false, dim: false, italic: false, underline: false, color: null };
}
function classesFor(state) {
  const classes = [];
  if (state.bold) classes.push("ansi-bold");
  if (state.dim) classes.push("ansi-dim");
  if (state.italic) classes.push("ansi-italic");
  if (state.underline) classes.push("ansi-underline");
  if (state.color) classes.push(state.color);
  return classes;
}
function applyCode(state, code) {
  if (code === 0) Object.assign(state, emptyState());
  else if (code === 1) state.bold = true;
  else if (code === 2) state.dim = true;
  else if (code === 3) state.italic = true;
  else if (code === 4) state.underline = true;
  else if (code === 22) {
    state.bold = false;
    state.dim = false;
  } else if (code === 23) state.italic = false;
  else if (code === 24) state.underline = false;
  else if (code >= 30 && code <= 37) state.color = `ansi-${COLORS[code - 30]}`;
  else if (code === 39) state.color = null;
  else if (code >= 90 && code <= 97) state.color = `ansi-bright-${COLORS[code - 90]}`;
}
function parseAnsi(line) {
  const spans = [];
  const state = emptyState();
  let cursor = 0;
  const push = (text) => {
    if (text) spans.push({ text, classes: classesFor(state) });
  };
  SGR.lastIndex = 0;
  let match;
  while ((match = SGR.exec(line)) !== null) {
    push(line.slice(cursor, match.index));
    for (const part of match[1].split(";")) {
      const code = Number(part === "" ? "0" : part);
      if (!Number.isNaN(code)) applyCode(state, code);
    }
    cursor = match.index + match[0].length;
  }
  push(line.slice(cursor));
  return spans;
}

// src/components/ConsolePane.tsx
import { jsx as jsx21 } from "react/jsx-runtime";
var DEFAULT_MAX_LINES = 2e3;
var BOTTOM_TOLERANCE_PX = 4;
function ConsolePane({
  lines,
  maxLines = DEFAULT_MAX_LINES,
  ariaLabel = "console output",
  className = ""
}) {
  const ref = useRef8(null);
  const pinned = useRef8(true);
  const visible = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  useEffect12(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [visible.length]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_TOLERANCE_PX;
  };
  return /* @__PURE__ */ jsx21(
    "div",
    {
      ref,
      role: "log",
      "aria-label": ariaLabel,
      "aria-live": "polite",
      onScroll,
      className: `console-pane scroll-slim ${className}`.trim(),
      children: visible.map((line, i) => /* @__PURE__ */ jsx21("div", { className: "console-line", children: parseAnsi(line).map((span, j) => /* @__PURE__ */ jsx21("span", { className: span.classes.join(" "), children: span.text }, j)) }, i))
    }
  );
}
export {
  ALL_TOKENS2 as ALL_TOKENS,
  ANSI_TOKENS,
  AppBar,
  BASE2 as BASE,
  BUILTIN_THEMES,
  BreadcrumbNav,
  CHROME_TOKENS2 as CHROME_TOKENS,
  Calendar,
  CheckGlyph,
  ColumnPanel,
  ConsolePane,
  DEFAULT_THEME_ID,
  FullscreenGlyph,
  HUE_NAMES,
  HUE_TOKENS,
  MaximizeGlyph,
  OPTIONAL_TOKENS,
  OverflowMenu,
  PREPAINT_SNIPPET,
  RestoreGlyph,
  SEMANTIC_TOKENS,
  SchemaControls,
  SchemaExplorer,
  SchemaExplorerPanel,
  SchemaGroupNode,
  TableNode,
  ThemeContext,
  ThemeIcon,
  ThemePicker,
  ThemeProvider,
  ThemeToggle,
  VisualZoomViewport,
  ZOOM_NEUTRAL,
  ZoomIndicator,
  applyResolvedTheme,
  applyTheme,
  cacheRows,
  computeLayout,
  counterpartTheme,
  createUseIcon,
  getSavedTheme,
  getSchemaColor,
  isThemeToken2 as isThemeToken,
  loadSelection,
  mergeRemoteThemes,
  parseAnsi,
  parseThemeRow,
  pickTheme,
  readCachedRows,
  rememberPreferred,
  resolveInitialTheme,
  resolveTheme,
  saveSelection,
  themeToCss,
  useColumns,
  useDarkClass,
  useDismiss,
  useTheme2 as useDocumentTheme,
  useFullscreen,
  useMaximized,
  useSchemaData,
  useTheme,
  useThemeRegistry,
  useZoomFactor,
  useZoomNeutral
};
