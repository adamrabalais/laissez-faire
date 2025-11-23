import { NextResponse } from 'next/server';

const SYSTEM_PROMPT = `
You are a meal planning assistant that finds REAL recipes from the web.
You MUST use the Google Search tool to find actual, existing recipes.
Do not invent recipes.
Structure the response as an array of recipe objects.
Each object must have: 
- id (number)
- title (string: The exact title from the website)
- description (short string)
- cuisine (string)
- kidFriendly (boolean)
- rating (number, extracted from the site if possible, else estimate 4.0-5.0)
- reviewCount (number, extracted or estimate)
- imageSearchQuery (string: keywords for a fallback stock photo)
- ingredients (array of objects: {name, amount (number), unit, category, emoji (string)})
- instructions (array of strings - summary of the real steps)
- servings (number, extracted from site)
- sourceUrl (string: The ACTUAL URL to the recipe found via Google Search.)

Categories: Produce, Meat, Pantry, Dairy, Bakery, Spices, Refrigerated.
`;

// Helper to scrape the REAL image from the website
async function fetchOgImage(url: string): Promise<string | null> {
  if (!url || url.includes('google.com')) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout
    
    const res = await fetch(url, { 
        signal: controller.signal,
        headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; LaissezFaireBot/1.0; +http://laissez-faire.app)' 
        } 
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) return null;
    const html = await res.text();
    
    // Try OG Image first (Standard)
    let match = html.match(/<meta property="og:image" content="([^"]+)"/i);
    if (match) return match[1];

    // Try Twitter Image (Common alternative)
    match = html.match(/<meta name="twitter:image" content="([^"]+)"/i);
    if (match) return match[1];

    // Try generic image_src (Old school)
    match = html.match(/<link rel="image_src" href="([^"]+)"/i);
    if (match) return match[1];

    return null;
  } catch (e) {
    return null; // Fail silently if site blocks bot
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { count, people, diet, kidFriendly, priority } = body;

  let priorityInstruction = "Find highly-rated recipes that balance cost and flavor."; 
  if (priority === 'Cheaper Ingredients') {
    priorityInstruction = "Search for budget-friendly recipes.";
  } else if (priority === 'Fewer Ingredients') {
    priorityInstruction = "Search for 5-ingredient or simple recipes.";
  } else if (priority === 'Fancier Meals') {
    priorityInstruction = "Search for gourmet or chef-quality recipes.";
  }

  // Explicitly asking for URLs allows the Search Tool to shine
  const userPrompt = `Search for and return ${count} distinct ${diet} dinner recipes for ${people} people. 
  ${kidFriendly ? "Ensure they are kid-friendly." : ""}
  ${priorityInstruction}
  Include the direct URL (sourceUrl) for each recipe found.
  Return ONLY the JSON array.`;

  const apiKey = (process.env.GOOGLE_API_KEY || '').trim();
  const unsplashAccessKey = (process.env.UNSPLASH_ACCESS_KEY || '').trim();

  // Using gemini-2.5-flash with Search Tools enabled
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n" + userPrompt }] }],
        // THIS ENABLES LIVE GOOGLE SEARCH
        tools: [{ google_search: {} }] 
      })
    });

    const data = await response.json();

    if (!data.candidates) {
      console.error("--- GENERATION FAILED ---");
      console.error("Error Details:", JSON.stringify(data, null, 2));
      return NextResponse.json({ 
        error: "API Error", 
        details: data.error?.message || "No candidates returned." 
      }, { status: 500 });
    }

    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let recipes = [];
    try {
        recipes = JSON.parse(text);
    } catch (parseError) {
        // Sometimes the model returns text before JSON, try to extract it
        const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
            recipes = JSON.parse(jsonMatch[0]);
        } else {
            return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
        }
    }

    // POST-PROCESSING: Scrape Real Images
    console.log("Scraping real images from sources...");
    const enhancedRecipes = await Promise.all(recipes.map(async (recipe: any) => {
        let imageUrl = null;

        // 1. Attempt to scrape the REAL image from the source URL
        if (recipe.sourceUrl && recipe.sourceUrl.startsWith('http')) {
            imageUrl = await fetchOgImage(recipe.sourceUrl);
        }

        // 2. Fallback to Unsplash ONLY if scraping failed
        if (!imageUrl && unsplashAccessKey) {
            try {
                const query = recipe.imageSearchQuery || recipe.title;
                const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&client_id=${unsplashAccessKey}`;
                const imgRes = await fetch(unsplashUrl);
                const imgData = await imgRes.json();
                imageUrl = imgData.results?.[0]?.urls?.regular || null;
            } catch (e) {
                console.error(`Unsplash failed for ${recipe.title}`);
            }
        }

        return { ...recipe, imageUrl };
    }));

    return NextResponse.json(enhancedRecipes);
    
  } catch (error) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: "Failed to generate recipes" }, { status: 500 });
  }
}
