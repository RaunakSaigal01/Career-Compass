# Backend fix steps — Career Compass

Status at time of writing: `npx tsc --noEmit -p tsconfig.json` in `backend/` reports **5 errors, all one root cause**. You had already fixed the missing `Body`/`Patch` imports and the `pdf-parse` v2 call while I was looking — those are clean now.

Everything in Part 1 has been applied to a scratch copy and verified to compile to **zero errors**.

---

## Part 1 — Blocking: the backend does not compile

### Step 1. Add the three missing `ResumesService` methods

`src/resumes/resumes.controller.ts` calls `getForUser`, `parseAndStore` and `saveProfile`; `scoreResume` and `getLatestAnalysis` also call `getForUser` internally. None of the three exist. That is all 5 errors.

In `src/resumes/resumes.service.ts`, paste these immediately above `listForUser`:

```ts
  async getForUser(userId: string, resumeId: string): Promise<ResumeDocument> {
    const resume = await this.resumeModel
      .findOne({ _id: resumeId, userId })
      .exec();
    if (!resume) {
      throw new NotFoundException('Resume not found.');
    }
    return resume;
  }

  async parseAndStore(
    userId: string,
    resumeId: string,
  ): Promise<ResumeDocument> {
    const resume = await this.getForUser(userId, resumeId);
    try {
      const text = await this.parsingService.extractText(
        resume.storagePath,
        resume.mimeType,
      );
      const profile = this.parsingService.parseProfile(text);
      resume.rawText = text;
      resume.parsedProfile = profile as unknown as Record<string, unknown>;
      resume.status = 'parsed';
    } catch {
      resume.status = 'failed';
    }
    await resume.save();
    return resume;
  }

  async saveProfile(
    userId: string,
    resumeId: string,
    profile: unknown,
  ): Promise<ResumeDocument> {
    const resume = await this.getForUser(userId, resumeId);
    resume.parsedProfile = profile as Record<string, unknown>;
    resume.status = 'parsed';
    await resume.save();
    return resume;
  }
```

`saveProfile` takes `unknown` deliberately so the controller's existing `body.profile` argument type-checks with no controller edit.

`getForUser` centralises the ownership check (`_id` **and** `userId` in one query), which is what stops user A reading user B's resume by guessing an id. `deleteForUser` already does this inline — you can simplify it to call `getForUser` later if you want.

### Step 2. Fix the cast that Step 1 will break

This is the non-obvious one. Line 39 of `resumes.service.ts`:

```ts
const profile = (resume.parsedProfile ?? {}) as ParsedProfile;
```

This compiles *today only because* `getForUser` is missing, so `resume` is inferred as `any` and casts freely. The moment you give `getForUser` a real `Promise<ResumeDocument>` return type, `resume.parsedProfile` becomes `Record<string, unknown> | undefined` and this line fails with TS2352 ("neither type sufficiently overlaps"). Change it to:

```ts
const profile = (resume.parsedProfile ?? {}) as unknown as ParsedProfile;
```

After Steps 1–2, `tsc --noEmit` is clean.

### Step 3. Fix the module wiring, or it compiles and then crashes on boot

`src/resumes/resumes.module.ts` imports `ParserModule` and `ScoringModule` at the top of the file but **never lists them in the `imports: []` array**. Meanwhile `ResumesService` injects `ParsingService`, `ScoringService`, and `@InjectModel(ResumeAnalysis.name)`. Two separate DI failures:

- `ParsingService` / `ScoringService` are unresolvable → Nest throws `UnknownDependenciesException` at startup.
- `ResumeAnalysisModel` is registered in `ScoringModule`, but `ScoringModule` exports only `ScoringService`, not `MongooseModule` — so the model token is unreachable from `ResumesService` even after you add the module import.

Add the schema import:

```ts
import {
  ResumeAnalysis,
  ResumeAnalysisSchema,
} from '../scoring/schemas/resume-analysis.schema';
```

and change the `imports` array so it starts:

```ts
  imports: [
    MongooseModule.forFeature([
      { name: Resume.name, schema: ResumeSchema },
      { name: ResumeAnalysis.name, schema: ResumeAnalysisSchema },
    ]),
    ParserModule,
    ScoringModule,
    MulterModule.register({ /* unchanged */ }),
  ],
```

Registering the same model in two modules is safe in Mongoose/Nest. While you're here, `JwtAuthGuard` in this module's `providers` is dead weight — `AuthGuard('jwt')` resolves the strategy from Passport's global registry, which `AuthModule` populates. Harmless, but misleading.

### Step 4. Confirm

```bash
cd backend
npx tsc --noEmit -p tsconfig.json   # expect zero output
npm run start:dev
```

`npx nest build` hangs in some setups; plain `tsc` is the faster signal.

---

## Part 2 — Will compile and boot, but is wrong at runtime

Ordered by how much user-visible damage each does.

### 5. Google sign-in silently drops the session

`auth.service.ts` returns a full `{ message, accessToken, user }` for `/auth/google`, but `GoogleSignInButton.tsx` reads only `data.message`. It never persists the token and never routes to `/dashboard` — `persistSession` lives in `page.tsx` and isn't passed down. A *successful* Google login leaves the user sitting on the login screen. Lift `persistSession` into a prop (or a shared hook) and call it with `data.accessToken` / `data.user`, then `router.push('/dashboard')`.

### 6. Nothing ever triggers parsing

`POST /resumes` stores `status: 'pending'` and returns. The dashboard then redirects straight to `/dashboard/resume/{id}`, which pre-fills every field from `doc.parsedProfile` — always empty, and `status` reads `'pending'` forever. Nothing in the frontend calls `POST /resumes/:id/parse`. Either call it right after upload succeeds, or just invoke `parseAndStore` at the end of `validateAndCreate` so upload-then-parse is one step.

### 7. `JWT_EXPIRES_IN` vs `JWT_EXPIRES`

`auth.module.ts` reads `JWT_EXPIRES_IN`; `.env` defines `JWT_EXPIRES`. The `?? '15m'` fallback wins silently, so your configured expiry has never applied. Pick one name. Also drop the `as unknown as number` cast on `expiresIn` — the correct type is `string | number`, and the cast is hiding that.

### 8. `UPLOAD_DIR` can never work

`resumes.module.ts` reads `process.env.UPLOAD_DIR` as module top-level code, which runs at *import* time — before `ConfigModule.forRoot()` has loaded `.env`. Adding `UPLOAD_DIR` to `.env` will do nothing. Use `MulterModule.registerAsync` with `ConfigService`, or load dotenv earlier. (`MONGODB_URI` in `app.module.ts` escapes this only by luck — array elements evaluate left to right, so `ConfigModule.forRoot` happens to run first.)

### 9. Wrong HTTP status codes

`validateAndCreate` throws `NotFoundException` (404) for a rejected extension or a bad file signature. Those are `BadRequestException` (400). Separately, `LoginDto` has `@MinLength(8)` on password, so under the global `ValidationPipe` a wrong short password returns a 400 validation error instead of your intended 401 "Invalid email or password" — and leaks that the rule exists. Validate length on register only.

### 10. A PATCH round-trip erases `sections.other`

Backend `SectionSplit` has 7 keys including `other`; the frontend's `ParsedSections` has 6. `parseProfile` derives the candidate's **name** from `sections.other`, so saving edits destroys the source of the name. Add `other` to the frontend type, or have `saveProfile` merge into the stored profile instead of replacing it wholesale.

### 11. PATCH and score bodies have zero validation

`@Body() body: { profile: unknown }` is a type literal, not a class, so `ValidationPipe` skips it entirely — arbitrary JSON lands straight in Mongo. Create a `SaveProfileDto` / `ScoreResumeDto` with `class-validator` decorators.

---

## Part 3 — Housekeeping

- **Remove `@types/pdf-parse`** from devDependencies. It types the dead v1 API; v2 ships its own types. Leaving it invites a future conflict.
- **`npm run lint`** clears ~88 of the 127 eslint errors automatically — nearly all of it is prettier CRLF/formatting noise, not real problems. Worth doing once so real errors stop hiding in the wall of output.
- The remaining `no-unsafe-*` warnings cluster in `parser/extractors.ts` around unchecked `text.match(...)` results, which return `any`. Guard the null case and the warnings go away.
- **`JwtStrategy.validate` never hits the DB**, so a token belonging to a deleted user stays valid until expiry. Inject `UsersService` and confirm the user still exists if that matters to you.
- **`file-type@22` is ESM-only** and works here only because you're on Node 22.23. It will break on Node < 22.12 — worth pinning an engines field so a grader on Node 20 doesn't hit a confusing failure.
- **`http://localhost:3001` is hardcoded in 4 frontend places.** Add `NEXT_PUBLIC_API_URL` to `frontend/.env.local` before you deploy or demo off-machine.
