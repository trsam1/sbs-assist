# Requirements: Scroll Text Upload (Step 4 — Observe the Text as a Scroll)

## Context and assumptions

This spec adds a second study tool to the suite: a **Scroll Study** for inductive-study
**Step 4 — Observe the Text as a Scroll**. A student uploads a document containing the
"scroll" form of a book of the Bible (the running text with chapter/verse markers removed
or de-emphasised), the system extracts the plain text, and the text is saved with the
study so it is available to the student while they work later steps.

The issue mentions a "Book Study" entity. No such entity exists in the product today (the
only shipped tool is the Step 5 word study, persisted as `StudyWorksheet` records keyed by
Cognito user). Rather than introduce a cross-tool "Book Study" aggregate — which would be a
larger product change than this feature needs — this spec treats a **Scroll Study** as its
own worksheet type, keyed by the same Cognito user, mirroring the existing word-study
pattern. "Associated with a Book Study" (acceptance criterion 3) is satisfied by the scroll
text being a persisted, re-openable Scroll Study record owned by the student. Linking a
scroll study to specific word studies is explicitly out of scope here (see Out of Scope);
if a unifying "Book Study" is wanted later it can reference these records.

Assumptions (flagged for the design review to confirm):
- "Google Doc" is not an uploadable binary format. A student exports a Google Doc as PDF or
  Word (`.docx`) and uploads that. The supported upload formats are therefore **PDF
  (`.pdf`), Word (`.docx`), and plain text (`.txt`)**. Legacy `.doc` (binary Word 97–2003)
  is out of scope.
- Extraction produces plain UTF-8 text; original formatting (fonts, columns, images) is not
  preserved — Step 4 works with running text.
- The student is authenticated (Cognito), consistent with the rest of the app.

---

## Requirement 1: Create a Scroll Study and upload a document

### User Story
As a Bible student, I want to start a Scroll Study and upload a document containing a book of
the Bible so that I can observe its text as a continuous scroll in later steps.

### Acceptance Criteria
1. WHEN the student opens the new-scroll-study view THEN the system SHALL display a book-name
   text input and a file picker that accepts `.pdf`, `.docx`, and `.txt` files.
2. WHEN the student selects a file whose extension is not `.pdf`, `.docx`, or `.txt` THEN the
   system SHALL reject it with an inline message and SHALL NOT request an upload URL.
3. WHEN the student selects a file larger than 10 MB THEN the system SHALL reject it with an
   inline message and SHALL NOT request an upload URL. (This client-side check is the primary
   size gate; the server-side bound is enforced during extraction — see Requirement 2 AC 6.)
4. WHEN the student submits a valid file THEN the system SHALL request a short-lived upload
   target from the API and upload the file bytes directly to S3 (the API SHALL NOT receive
   the file bytes). The client does NOT send any status update after the upload; extraction
   advances the status (see Requirement 2).
5. IF the upload URL request or the S3 upload fails THEN the system SHALL display an error and
   allow the student to retry without losing the entered book name.
6. The book-name input SHALL be required and limited to 100 characters.

### Correctness Properties
- Property: For any filename, `isAllowedUpload` returns `true` if and only if the lower-cased
  extension is one of `.pdf`, `.docx`, `.txt`.
- Property: `createUploadTarget` only ever issues keys under the authenticated user's prefix
  (`uploads/<userId>/...`); for any two distinct user IDs the key prefixes do not overlap.

---

## Requirement 2: Extract text from the uploaded document

### User Story
As a Bible student, I want the text of my uploaded document extracted automatically so that I
do not have to retype or copy-paste the book.

### Acceptance Criteria
1. WHEN a file finishes uploading to S3 THEN the system SHALL move the Scroll Study from
   `uploading` to `extracting` and extract its plain text: `.txt` read as UTF-8, `.pdf` via a
   PDF text extractor, `.docx` via a Word extractor. The extraction worker (not the client)
   SHALL be the only writer of the `extracting`, `ready`, and `failed` statuses.
2. WHEN extraction succeeds THEN the system SHALL store the extracted text on the Scroll Study
   record and set its status to `ready`.
3. WHEN the extracted text exceeds the per-record storage limit (see design) THEN the system
   SHALL store the text truncated to the limit, set status to `ready`, and record that
   truncation occurred.
4. IF extraction fails (unreadable, encrypted, image-only PDF with no text layer, or empty
   result) THEN the system SHALL set the study status to `failed` with a human-readable reason
   and SHALL NOT leave the study stuck in `extracting`.
5. The extraction result SHALL be plain UTF-8 text with no HTML markup.
6. WHEN the uploaded object's size exceeds 10 MB THEN the extraction worker SHALL set status to
   `failed` with reason "file too large" and SHALL NOT attempt extraction. (The presigned
   `PUT` URL does not bind content length, so this is the authoritative server-side size gate;
   see design "Validation rules".)
7. WHEN an S3 object-created event carries a key that does not match the expected
   `uploads/<userId>/<scrollStudyId>.<ext>` shape THEN the extraction worker SHALL log and
   ignore it (there is no record to update), so it never errors on an unexpected key.

### Correctness Properties
- Property: `extractText` never throws for any `Buffer` input of a supported type; it returns
  either a non-empty string or a typed failure describing why.
- Property: For any extracted string longer than the limit, the stored `scrollText` length is
  exactly the limit and `truncated` is `true`; otherwise `truncated` is `false`.

---

## Requirement 3: View extraction status and the extracted scroll text

### User Story
As a Bible student, I want to see whether my upload is still processing, ready, or failed, and
read the extracted text so that I can confirm the right book was captured.

### Acceptance Criteria
1. WHILE a Scroll Study status is `uploading` or `extracting` THE system SHALL show a
   non-blocking "processing" indicator and poll for status updates.
2. WHEN status becomes `ready` THEN the system SHALL display the extracted scroll text in a
   scrollable, read-only region, and SHALL show a truncation notice IF the text was truncated.
3. WHEN status becomes `failed` THEN the system SHALL display the failure reason and offer
   re-upload.
4. Polling SHALL stop once status is `ready` or `failed`.

---

## Requirement 4: Persist, list, re-open, and delete Scroll Studies

### User Story
As a Bible student, I want my Scroll Studies saved to my library on their own list so that I
can re-open the extracted text later and delete studies I no longer need, without them being
mixed in with my word studies.

### Acceptance Criteria
1. WHEN a Scroll Study is created THEN it SHALL be stored in DynamoDB keyed by the
   authenticated Cognito user (`sub`), the same scoping the word-study tool uses.
2. WHEN the student opens the **Scroll Studies list** (its own route/section, separate from the
   word-study list at `/`) THEN the list SHALL show **only** that student's Scroll Studies,
   sorted most-recently-updated first; each row SHALL show the book name as its title and the
   study status, and the list SHALL NOT contain any word-study rows. The existing word-study
   list is unchanged and continues to show only word studies.
3. WHEN the student opens a Scroll Study row THEN the system SHALL route to `/scroll/:id`; the
   word-study list continues to route its rows to `/study/:id`. Navigation to the Scroll
   Studies list is provided by a dedicated navbar entry alongside the existing word-study
   entries (see design).
4. WHEN the student re-opens a `ready` Scroll Study THEN the system SHALL display the stored
   book name and extracted scroll text.
5. WHEN the student deletes a Scroll Study THEN the system SHALL delete the DynamoDB record and
   the associated uploaded S3 object.
6. A student SHALL only ever be able to read, list, or delete their own Scroll Studies; a
   request for another user's `scrollStudyId` SHALL return 404.

### Correctness Properties
- Property: For any valid create input, `saveScrollStudy` followed by a get with the returned
  `scrollStudyId` returns a record whose `bookName` and `userId` match the saved input and
  whose `createdAt` is preserved across updates while `updatedAt` advances.

---

## Non-Functional Requirements

1. **Serverless-first / cost:** no always-on compute; uploads go straight to S3 via presigned
   URL; extraction runs in Lambda; storage is DynamoDB + S3 on-demand/pay-per-use.
2. **No copyrighted-text policy unchanged:** the uploaded document is the student's own file,
   stored privately and scoped to the student; it is never served to other users and never
   placed in an AI prompt by this feature. This is student-provided content, not app-served
   Bible text.
3. **Security:** all API routes authenticated with the existing Cognito authorizer; S3 upload
   bucket blocks public access; presigned URLs are short-lived and user-scoped; IAM is
   least-privilege per Lambda.
4. **Stage parity:** the dev stage uses `-dev` physical names and `DESTROY` removal, matching
   existing conventions in `stage-config.ts`; no prod values are edited.

---

## Out of Scope

- A cross-tool "Book Study" aggregate linking scroll studies to word studies or other steps.
- Editing or re-formatting the extracted text in-app (read-only display only).
- OCR of image-only / scanned PDFs (no text layer → `failed`).
- Legacy `.doc`, RTF, ePub, or direct Google Drive integration.
- Chapter/verse structural parsing of the scroll (Step 4 observes running text; structure is
  Step 7).
- Using the scroll text in the AI summary or any other step tool.
