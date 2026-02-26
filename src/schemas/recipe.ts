import { z } from "zod";

export const IngredientSchema = z.object({
  quantity: z.number().describe("Numeric quantity (e.g. 2, 0.5)"),
  unit: z.string().describe("Unit of measure (e.g. cups, tbsp, pieces). Empty string if unitless"),
  name: z.string().describe("Ingredient name (e.g. all-purpose flour)"),
  description: z
    .string()
    .describe("Preparation notes (e.g. sifted, finely chopped). Empty string if none"),
});

export const RecipeSchema = z.object({
  title: z.string().describe("Recipe title"),
  ingredients: z.array(IngredientSchema).describe("Parsed ingredient list"),
  preparationSteps: z
    .array(z.string())
    .describe("Steps before cooking (e.g. marinate, chop, mix dough)"),
  cookingSteps: z.array(z.string()).describe("Steps involving heat or the actual cooking process"),
  notes: z
    .object({
      servings: z
        .string()
        .optional()
        .describe("Number of servings (e.g. '4 servings', 'Makes 12')"),
      cookTime: z.string().optional().describe("Cooking time (e.g. '30 minutes')"),
      prepTime: z.string().optional().describe("Preparation time (e.g. '15 minutes')"),
      tips: z.array(z.string()).optional().describe("Additional tips or notes from the recipe"),
    })
    .describe("Recipe metadata and tips"),
});

export type Ingredient = z.infer<typeof IngredientSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
