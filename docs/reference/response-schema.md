# Response Schema

The agent returns a validated `Recipe` object (or an error object on failure).

## Recipe

```json
{
  "title": "Chicken Wontons in Spicy Chili Sauce",
  "ingredients": [
    {
      "quantity": 3,
      "unit": "tablespoons",
      "name": "sesame oil",
      "description": "divided"
    },
    {
      "quantity": 2,
      "unit": "",
      "name": "eggs",
      "description": "beaten"
    }
  ],
  "preparationSteps": [
    "Slice shiitake mushrooms",
    "Grate garlic clove"
  ],
  "cookingSteps": [
    "Heat 1 tablespoon sesame oil in a large nonstick skillet over medium heat..."
  ],
  "notes": {
    "servings": "4 servings",
    "cookTime": "10 minutes",
    "prepTime": "5 minutes",
    "tips": ["Use mini chicken cilantro wontons for best results"]
  }
}
```

## Field Reference

### Ingredient

| Field | Type | Description |
|---|---|---|
| `quantity` | `number` | Numeric quantity (fractions converted: 1/2 → 0.5) |
| `unit` | `string` | Measurement unit; empty string `""` for unitless (e.g. "2 eggs") |
| `name` | `string` | Ingredient name |
| `description` | `string` | Preparation notes; empty string `""` if none |

### Recipe

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Recipe title |
| `ingredients` | `Ingredient[]` | Yes | List of ingredients |
| `preparationSteps` | `string[]` | Yes | Steps without heat (chopping, mixing, marinating) |
| `cookingSteps` | `string[]` | Yes | Steps involving heat or actual cooking |
| `notes` | `object` | No | Optional metadata (see below) |

### Notes

All fields within `notes` are optional. The entire `notes` object may be omitted.

| Field | Type | Description |
|---|---|---|
| `servings` | `string` | Serving count |
| `cookTime` | `string` | Cooking duration |
| `prepTime` | `string` | Preparation duration |
| `tips` | `string[]` | Additional tips or variations |

## Error Responses

On failure, the agent returns an error object instead of a Recipe:

```json
{
  "error": "bad_request",
  "message": "No URL found in request. Provide {\"url\": \"...\"} or a prompt containing a URL."
}
```

| Error Code | Cause |
|---|---|
| `bad_request` | No URL in request body |
| `agent_error` | LLM invocation failed |
| `parse_error` | Agent response couldn't be parsed as Recipe JSON |
| `blocked` | Request or response blocked by Prisma AIRS |
