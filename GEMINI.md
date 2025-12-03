# Miraverse Project Context

## Project Overview
**Miraverse** is an AI-powered tutor and content generation platform built with Next.js 16. It allows users to aggregate various data sources (PDFs, links, YouTube videos, text) and generate educational or analytical content using the Gemini 2.0 Flash/Pro models.

## Tech Stack
- **Framework:** Next.js 16.0.6 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **AI:** Google Generative AI SDK (`@google/generative-ai`) targeting `gemini-3-pro-preview`
- **Data Processing:** 
  - `pdfjs-dist`: PDF text extraction
  - `cheerio`: Web scraping (implied for links)
  - `youtube-transcript`: YouTube video transcript fetching
- **UI State:** React 19 (Client Components)

## Key Directories & Files
- **`src/app/page.tsx`**: Main application entry point. Handles UI state for sources, chat history, and studio result generation. Implements specific views for Quizzes, Infographics, and Slides.
- **`src/lib/gemini.ts`**: Core AI logic. Defines `StudioMode` types, system prompts, and the `runGemini` function that interfaces with Google's API. Handles context window management (`trimSources`).
- **`src/app/api/`**: Backend API routes.
  - `generate/`: Proxies requests to Gemini.
  - `upload/`: Handles file uploads and text extraction (PDF/Text).
  - `link/`: (Inferred) Fetches and parses content from external URLs.
  - `youtube/`: (Inferred) Fetches transcripts from YouTube videos.

## Core Workflows

### 1. Source Ingestion
Users can add context via:
- **Files:** Uploaded to `/api/upload`, parsed server-side.
- **Links:** Processed via `/api/link`.
- **YouTube:** Transcripts fetched via `/api/youtube`.
- **Text:** Direct input.

All sources are normalized to the `Source` type: `{ id, title, type, content }`.

### 2. Content Generation (Studio)
The platform supports multiple generation modes (`StudioMode`):
- **Chat:** Interactive dialogue with context.
- **Structured Output:** Quiz (JSON), Infographic (JSON), Slides (JSON).
- **Text Output:** Audio/Video scripts, Mindmaps, Reports, Flashcards.

Requests are sent to `/api/generate` with the selected mode, prompt, and aggregated source context.

### 3. Visualization
Specific modes have dedicated React components for rendering structured data:
- **Quiz:** Interactive MCQ interface.
- **Infographic:** Block-based layout.
- **Slides:** Bullet-point presentation view.

## Development Setup

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Environment Variables:**
    Create a `.env.local` file with:
    ```env
    GOOGLE_API_KEY=your_gemini_api_key
    ```

3.  **Run Development Server:**
    ```bash
    npm run dev
    ```

## Conventions
- **"use client":** `src/app/page.tsx` is a Client Component to manage complex UI state.
- **API Handling:** API routes are used for heavy lifting (file parsing, AI calls) to keep the client light and secure keys.
- **Markdown:** The AI is instructed to output Markdown (parsed by `marked`) or strict JSON for specific components.
- **Strict Types:** TypeScript is used to enforce contracts between the UI and API (e.g., `QuizQuestion`, `InfographicSpec`).
