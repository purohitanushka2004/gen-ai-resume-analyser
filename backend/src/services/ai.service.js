const { GoogleGenAI } = require("@google/genai")
const puppeteer = require("puppeteer")

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY
})

const MODEL_NAME = "gemini-2.5-flash"

/* ---------------- HAND-WRITTEN GEMINI SCHEMA (INTERVIEW REPORT) ---------------- */
// Written by hand instead of via zodToJsonSchema to avoid $ref-inlining issues
// that caused Gemini to flatten nested objects into plain strings.
const geminiInterviewReportSchema = {
    type: "object",
    properties: {
        matchScore: {
            type: "number",
            description: "A score between 0 and 100 indicating how well the candidate's profile matches the job description"
        },
        technicalQuestions: {
            type: "array",
            description: "Technical questions that can be asked in the interview along with their intention and how to answer them",
            items: {
                type: "object",
                properties: {
                    question: { type: "string", description: "The technical question that can be asked in the interview" },
                    intention: { type: "string", description: "The intention of the interviewer behind asking this question" },
                    answer: { type: "string", description: "How to answer this question, what points to cover, what approach to take" }
                },
                required: ["question", "intention", "answer"]
            }
        },
        behavioralQuestions: {
            type: "array",
            description: "Behavioral questions that can be asked in the interview along with their intention and how to answer them",
            items: {
                type: "object",
                properties: {
                    question: { type: "string", description: "The behavioral question that can be asked in the interview" },
                    intention: { type: "string", description: "The intention of the interviewer behind asking this question" },
                    answer: { type: "string", description: "How to answer this question, what points to cover, what approach to take" }
                },
                required: ["question", "intention", "answer"]
            }
        },
        skillGaps: {
            type: "array",
            description: "List of skill gaps in the candidate's profile along with their severity",
            items: {
                type: "object",
                properties: {
                    skill: { type: "string", description: "The skill which the candidate is lacking" },
                    severity: { type: "string", enum: ["low", "medium", "high"], description: "The severity of this skill gap" }
                },
                required: ["skill", "severity"]
            }
        },
        preparationPlan: {
            type: "array",
            description: "A day-wise preparation plan for the candidate",
            items: {
                type: "object",
                properties: {
                    day: { type: "number", description: "The day number in the preparation plan, starting from 1" },
                    focus: { type: "string", description: "The main focus of this day in the preparation plan" },
                    tasks: {
                        type: "array",
                        description: "List of tasks to be done on this day",
                        items: { type: "string" }
                    }
                },
                required: ["day", "focus", "tasks"]
            }
        },
        title: {
            type: "string",
            description: "The title of the job for which the interview report is generated"
        }
    },
    required: ["matchScore", "technicalQuestions", "behavioralQuestions", "skillGaps", "preparationPlan", "title"]
}

/* ---------------- HAND-WRITTEN GEMINI SCHEMA (RESUME) ---------------- */
const geminiResumeSchema = {
    type: "object",
    properties: {
        html: {
            type: "string",
            description: "The HTML content of the resume which can be converted to PDF using puppeteer"
        }
    },
    required: ["html"]
}

/* ---------------- SAFE PARSER ---------------- */
function safeParse(text) {
    if (!text || typeof text !== "string") {
        throw new Error("Empty response from AI")
    }

    text = text.replace(/```json|```/g, "").trim()
    return JSON.parse(text)
}

/* ---------------- GEMINI RESPONSE EXTRACTOR ---------------- */
function extractText(response) {
    if (response.text) return response.text;

    if (response.output) return response.output;

    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
        return response.candidates[0].content.parts[0].text;
    }

    throw new Error("No valid response text from Gemini");
}

/* ---------------- RETRY WRAPPER ---------------- */
// Retries on transient errors like 503 UNAVAILABLE (model overloaded).
// Does NOT retry on permanent errors like 404 (bad model name) or 400 (bad request).
async function generateContentWithRetry(params, retries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await ai.models.generateContent(params)
        } catch (err) {
            const message = err?.message || ""
            const isRetryable = message.includes("UNAVAILABLE") || message.includes("503") || message.includes("RESOURCE_EXHAUSTED")

            if (!isRetryable || attempt === retries) {
                throw err
            }

            console.warn(`Gemini model overloaded, retrying (${attempt}/${retries})...`)
            await new Promise(r => setTimeout(r, delayMs * attempt)) // simple linear backoff
        }
    }
}

/* ---------------- INTERVIEW REPORT ---------------- */
async function generateInterviewReport({ resume, selfDescription, jobDescription }) {

    const prompt = `
Generate an interview report for a candidate with the following details:
Resume: ${resume}
Self Description: ${selfDescription}
Job Description: ${jobDescription}

Populate every field of the schema in full detail. Specifically:
- Provide at least 3-5 technicalQuestions and 3-5 behavioralQuestions, each with a question, intention, and answer.
- Provide skillGaps based on comparing the resume against the job description.
- Provide a multi-day preparationPlan (at least 5 days) with focus and tasks for each day.
- Provide a concise "title" field representing the job title/role being interviewed for, based on the Job Description.
Do not leave any array empty.
`

    const response = await generateContentWithRetry({
        model: MODEL_NAME,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: geminiInterviewReportSchema,
        }
    })

    const rawText = extractText(response)
    const parsed = safeParse(rawText)

    if (!parsed.title || typeof parsed.title !== "string" || !parsed.title.trim()) {
        parsed.title = jobDescription?.split("\n")[0]?.slice(0, 80)?.trim() || "Untitled Position"
    }

    return parsed
}

/* ---------------- PDF GENERATOR ---------------- */
async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch()
    const page = await browser.newPage()

    await page.setContent(htmlContent, { waitUntil: "networkidle0" })

    const pdfBuffer = await page.pdf({
        format: "A4",
        margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm"
        }
    })

    await browser.close()
    return pdfBuffer
}

/* ---------------- RESUME PDF ---------------- */
async function generateResumePdf({ resume, selfDescription, jobDescription }) {

    const prompt = `
Generate resume for a candidate with the following details:
Resume: ${resume}
Self Description: ${selfDescription}
Job Description: ${jobDescription}

the response should be a JSON object with a single field "html"
The resume should be ATS friendly and professional.
`

    const response = await generateContentWithRetry({
        model: MODEL_NAME,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: geminiResumeSchema,
        }
    })

    const jsonContent = safeParse(extractText(response))

    const pdfBuffer = await generatePdfFromHtml(jsonContent.html)

    return pdfBuffer
}

module.exports = { generateInterviewReport, generateResumePdf }