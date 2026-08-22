/**
 * Formato neutral de JSON Schema, independiente del proveedor de IA. Se define una
 * sola vez por caso de uso (intent, entidades) y se convierte al formato especifico
 * que pide cada proveedor (OpenAI Structured Outputs vs Gemini responseSchema),
 * que difieren en como expresan "nullable" y en el casing de los tipos.
 */
export type NeutralSchema =
  | { type: "string"; enum?: string[]; nullable?: boolean; description?: string }
  | { type: "number"; nullable?: boolean; description?: string }
  | { type: "array"; items: NeutralSchema; nullable?: boolean }
  | { type: "object"; properties: Record<string, NeutralSchema>; required: string[] };

export function toOpenAiJsonSchema(schema: NeutralSchema): Record<string, unknown> {
  switch (schema.type) {
    case "string": {
      const type = schema.nullable ? ["string", "null"] : "string";
      const enumValues = schema.enum
        ? schema.nullable
          ? [...schema.enum, null]
          : schema.enum
        : undefined;
      return { type, ...(enumValues ? { enum: enumValues } : {}), ...(schema.description ? { description: schema.description } : {}) };
    }
    case "number":
      return { type: schema.nullable ? ["number", "null"] : "number", ...(schema.description ? { description: schema.description } : {}) };
    case "array":
      return { type: schema.nullable ? ["array", "null"] : "array", items: toOpenAiJsonSchema(schema.items) };
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, toOpenAiJsonSchema(value)]),
        ),
        required: schema.required,
        additionalProperties: false,
      };
  }
}

export function toGeminiSchema(schema: NeutralSchema): Record<string, unknown> {
  switch (schema.type) {
    case "string":
      return {
        type: "STRING",
        nullable: !!schema.nullable,
        ...(schema.enum ? { enum: schema.enum } : {}),
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "number":
      return { type: "NUMBER", nullable: !!schema.nullable, ...(schema.description ? { description: schema.description } : {}) };
    case "array":
      return { type: "ARRAY", nullable: !!schema.nullable, items: toGeminiSchema(schema.items) };
    case "object":
      return {
        type: "OBJECT",
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
        ),
        required: schema.required,
      };
  }
}
