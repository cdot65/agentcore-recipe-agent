import { describe, expect, it } from "vitest";
import { IngredientSchema, RecipeSchema } from "../../../src/schemas/recipe.js";

describe("IngredientSchema", () => {
  const valid = { quantity: 2, unit: "cups", name: "flour", description: "sifted" };

  it("accepts valid ingredient", () => {
    expect(IngredientSchema.parse(valid)).toEqual(valid);
  });

  it("accepts empty unit (unitless ingredient)", () => {
    const input = { ...valid, unit: "" };
    expect(IngredientSchema.parse(input)).toEqual(input);
  });

  it("accepts empty description", () => {
    const input = { ...valid, description: "" };
    expect(IngredientSchema.parse(input)).toEqual(input);
  });

  it("accepts decimal quantity", () => {
    const input = { ...valid, quantity: 0.5 };
    expect(IngredientSchema.parse(input)).toEqual(input);
  });

  it("rejects missing quantity", () => {
    const { quantity, ...rest } = valid;
    expect(() => IngredientSchema.parse(rest)).toThrow();
  });

  it("rejects string quantity", () => {
    expect(() => IngredientSchema.parse({ ...valid, quantity: "two" })).toThrow();
  });

  it("rejects missing name", () => {
    const { name, ...rest } = valid;
    expect(() => IngredientSchema.parse(rest)).toThrow();
  });

  it("rejects missing unit", () => {
    const { unit, ...rest } = valid;
    expect(() => IngredientSchema.parse(rest)).toThrow();
  });

  it("rejects missing description", () => {
    const { description, ...rest } = valid;
    expect(() => IngredientSchema.parse(rest)).toThrow();
  });
});

describe("RecipeSchema", () => {
  const validRecipe = {
    title: "Test Recipe",
    ingredients: [{ quantity: 2, unit: "cups", name: "flour", description: "" }],
    preparationSteps: ["Chop onions"],
    cookingSteps: ["Bake at 350F"],
    notes: {},
  };

  it("accepts valid recipe", () => {
    expect(RecipeSchema.parse(validRecipe)).toEqual(validRecipe);
  });

  it("accepts empty ingredients array", () => {
    const input = { ...validRecipe, ingredients: [] };
    expect(RecipeSchema.parse(input)).toEqual(input);
  });

  it("accepts empty prep and cooking steps", () => {
    const input = { ...validRecipe, preparationSteps: [], cookingSteps: [] };
    expect(RecipeSchema.parse(input)).toEqual(input);
  });

  it("accepts notes with all optional fields", () => {
    const input = {
      ...validRecipe,
      notes: {
        servings: "4 servings",
        cookTime: "30 minutes",
        prepTime: "15 minutes",
        tips: ["Let rest 10 minutes"],
      },
    };
    expect(RecipeSchema.parse(input)).toEqual(input);
  });

  it("accepts notes with partial fields", () => {
    const input = { ...validRecipe, notes: { servings: "4" } };
    expect(RecipeSchema.parse(input)).toEqual(input);
  });

  it("accepts empty notes object", () => {
    expect(RecipeSchema.parse(validRecipe).notes).toEqual({});
  });

  it("rejects missing title", () => {
    const { title, ...rest } = validRecipe;
    expect(() => RecipeSchema.parse(rest)).toThrow();
  });

  it("rejects missing ingredients", () => {
    const { ingredients, ...rest } = validRecipe;
    expect(() => RecipeSchema.parse(rest)).toThrow();
  });

  it("rejects missing preparationSteps", () => {
    const { preparationSteps, ...rest } = validRecipe;
    expect(() => RecipeSchema.parse(rest)).toThrow();
  });

  it("rejects missing cookingSteps", () => {
    const { cookingSteps, ...rest } = validRecipe;
    expect(() => RecipeSchema.parse(rest)).toThrow();
  });

  it("rejects missing notes", () => {
    const { notes, ...rest } = validRecipe;
    expect(() => RecipeSchema.parse(rest)).toThrow();
  });

  it("rejects invalid ingredient in array", () => {
    const input = {
      ...validRecipe,
      ingredients: [{ quantity: "bad", unit: "cups", name: "flour", description: "" }],
    };
    expect(() => RecipeSchema.parse(input)).toThrow();
  });

  it("accepts multiple ingredients", () => {
    const input = {
      ...validRecipe,
      ingredients: [
        { quantity: 2, unit: "cups", name: "flour", description: "" },
        { quantity: 3, unit: "", name: "eggs", description: "beaten" },
      ],
    };
    expect(RecipeSchema.parse(input)).toEqual(input);
  });
});
