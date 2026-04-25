# Tasks: Bible Word Study Tool

## Task 1: Project Scaffolding and Infrastructure

- [x] 1.1 Initialize Angular project with standalone components, signals, and Bulma CSS
- [x] 1.2 Initialize AWS CDK project (TypeScript) for infrastructure-as-code
- [x] 1.3 Define CDK stack: DynamoDB tables (WordStudies with GSI, StrongsData), API Gateway with usage plan and throttling, S3 bucket, CloudFront distribution
- [x] 1.4 Define CDK stack: Lambda functions (StrongsLookup, StudyCRUD, AISummary) with least-privilege IAM roles
- [x] 1.5 Configure API Gateway CORS to allow only the CloudFront domain
- [x] 1.6 Create shared TypeScript interfaces for data models (WordStudyEntry, CrossReference, StudyWorksheet, StrongsRecord, WordStudyRecord)

## Task 2: Strong's Data Seeding

- [x] 2.1 Write a data seeding script that loads the Open Scriptures Strong's Hebrew and Greek dictionaries into the StrongsData DynamoDB table (DEF and LEXICON records)
- [x] 2.2 Write a data seeding script that loads cross-reference mappings (XREF records) into the StrongsData table from the concordance dataset
- [x] 2.3 Validate seeded data: spot-check known Strong's numbers (e.g., G25, H157) for correct definition, original word, transliteration, and lexicon entry

## Task 3: Strong's Lookup Lambda

- [x] 3.1 Implement `getStrongsStudyData` handler: fetch DEF and LEXICON records in parallel from DynamoDB, return with fallback strings for missing data
- [x] 3.2 Implement `getCrossReferences` handler: query XREF records using `begins_with` on SK, return array of reference strings with empty notes
- [x] 3.3 Implement `validateStrongsNumber` utility function with pattern `/^[GH]\d+$/`
- [x] 3.4 Implement `getTestament` utility function (H → OT, G → NT)
- [x] 3.5 Wire up API Gateway routes: `GET /strongs/{strongsNumber}` and `GET /strongs/{strongsNumber}/cross-references`
- [x] 3.6 Write unit tests for Strong's Lookup Lambda handlers and utility functions

## Task 4: Study CRUD Lambda

- [x] 4.1 Implement `saveWordStudy` handler: create or update study record in DynamoDB with auto-generated studyId, timestamps, and GSI attributes
- [x] 4.2 Implement `getStudy` handler: fetch a single study by userId + studyId
- [x] 4.3 Implement `listStudies` handler: query studies by userId using GSI1, sorted by updatedAt descending
- [x] 4.4 Implement `deleteStudy` handler: delete a study record by userId + studyId
- [x] 4.5 Wire up API Gateway routes: `POST /studies`, `GET /studies/{studyId}`, `GET /studies`, `DELETE /studies/{studyId}`
- [x] 4.6 Write unit tests for Study CRUD Lambda handlers

## Task 5: AI Summary Lambda

- [x] 5.1 Implement `generateStudySummary` handler: build prompt from WordStudyEntry data including user's cross-reference observations, invoke Bedrock Claude 3 Haiku, parse response
- [x] 5.2 Implement graceful fallback: return "AI summary unavailable. Please try again later." on Bedrock failure
- [x] 5.3 Wire up API Gateway route: `POST /ai/study-summary`
- [x] 5.4 Write unit tests for AI Summary Lambda with mocked Bedrock client

## Task 6: Angular Frontend — Study Input Component

- [x] 6.1 Create StudyInputComponent with reactive form: word text input and Strong's number text input with `/^[GH]\d+$/` validation
- [x] 6.2 Display inline validation errors for invalid Strong's number format and empty fields
- [x] 6.3 On valid submission, emit StudyInput to parent and trigger Strong's lookup API call

## Task 7: Angular Frontend — Study Worksheet Component

- [x] 7.1 Create StudyWorksheetComponent that displays the step-by-step word study workflow
- [x] 7.2 Display Strong's data section: Strong's number, definition, original word, transliteration, lexicon entry, English definition
- [x] 7.3 Display cross-reference locations list with a text area for per-reference notes on each
- [x] 7.4 Add general notes text area for overall observations
- [x] 7.5 Add "Generate AI Summary" button that calls the AI summary endpoint and displays the result
- [x] 7.6 Add "Save" button that persists the worksheet via the Study CRUD API
- [x] 7.7 Support loading a saved study and populating all fields including notes and AI summary

## Task 8: Angular Frontend — Study List Component

- [x] 8.1 Create StudyListComponent that fetches and displays saved studies (word, Strong's number, date, status)
- [x] 8.2 Allow opening a saved study to view or continue editing (navigate to worksheet)
- [x] 8.3 Allow deleting a saved study with confirmation

## Task 9: Angular Frontend — Routing, Layout, and Anonymous Identity

- [x] 9.1 Set up Angular routing: home/study list route, new study route, edit study route (lazy-loaded)
- [x] 9.2 Create app layout with Bulma navbar and responsive container
- [x] 9.3 Implement anonymous user ID service: generate UUID on first visit, store in localStorage, reuse on subsequent visits
- [x] 9.4 Create HTTP interceptor or service that includes userId in all API calls

## Task 10: English Dictionary Definition

- [x] 10.1 Implement `fetchEnglishDefinition` service/function that retrieves a dictionary definition for the entered word (using a free dictionary API or bundled data)
- [x] 10.2 Handle API failure gracefully: return "Definition not available" fallback
- [x] 10.3 Integrate into the Study Worksheet display

## Task 11: End-to-End Integration and Deployment

- [x] 11.1 End-to-end test: enter word + Strong's number → view definition and lexicon → view cross-references → add notes → generate AI summary → save → reload and verify
- [x] 11.2 Deploy CDK stack to AWS and verify all resources are created correctly
- [x] 11.3 Deploy Angular frontend to S3 and verify CloudFront serves the application
