"""Expand the reviewed resume dataset with 200 additional high-quality resumes from the corpus."""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / "scripts"))

from structured_pipeline import (
    SCHEMA,
    empty_extraction,
    normalize_extraction,
    text_hash,
)

EXISTING_REVIEWED = ROOT / "data" / "structured" / "reviewed_qwen_v2.jsonl"
MANIFEST_PATH = ROOT / "data" / "training_sample" / "raw" / "manifest.csv"
DOCCANO_IMPORT = ROOT / "data" / "training_sample" / "raw" / "doccano_import.jsonl"
OUTPUT_PATH = ROOT / "data" / "structured" / "reviewed_300.jsonl"

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}")
LINKEDIN_RE = re.compile(r"(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[a-zA-Z0-9_\-\/]+", re.I)
GITHUB_RE = re.compile(r"(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_\-\/]+", re.I)

SECTION_HEADINGS: dict[str, re.Pattern] = {
    "summary": re.compile(
        r"^(?:summary|professional summary|executive summary|career summary|profile|about me|objective|career objective)\s*[:-]?\s*$",
        re.I,
    ),
    "experience": re.compile(
        r"^(?:work history|work experience|professional experience|experience|employment history|career history|internships?)\s*[:-]?\s*$",
        re.I,
    ),
    "education": re.compile(
        r"^(?:education|education and training|education & training|academic background|qualifications|academic history)\s*[:-]?\s*$",
        re.I,
    ),
    "skills": re.compile(
        r"^(?:technical skills|skills|technologies|tools|competencies|skill set|core competencies|areas of expertise)\s*[:-]?\s*$",
        re.I,
    ),
    "projects": re.compile(
        r"^(?:projects|key projects|academic projects|personal projects|technical projects)\s*[:-]?\s*$",
        re.I,
    ),
    "certifications": re.compile(
        r"^(?:certifications?|certificates|licenses & certifications|licenses and certifications|licenses|courses|credentials)\s*[:-]?\s*$",
        re.I,
    ),
}

COMMON_SKILLS = [
    "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "C", "Go", "Rust", "PHP", "Ruby", "Swift", "Kotlin",
    "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "Oracle",
    "React", "Node.js", "Angular", "Vue.js", "Next.js", "Express", "Django", "FastAPI", "Spring Boot", "Flask",
    "HTML", "CSS", "Tailwind CSS", "Bootstrap", "Sass",
    "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "CI/CD", "Git", "GitHub", "Linux", "Unix",
    "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "Scikit-Learn", "NLP", "Computer Vision", "Pandas", "NumPy",
    "REST API", "GraphQL", "Microservices", "Agile", "Scrum", "Jira",
    "Accounting", "Financial Analysis", "QuickBooks", "Excel", "GAAP", "Auditing", "Tax Preparation", "Budgeting",
    "Sales Management", "Customer Service", "Marketing Strategy", "Project Management", "Leadership", "Public Speaking",
    "Healthcare", "Clinical Research", "Patient Care", "BLS", "CPR", "Nursing", "EMR",
]


def extract_full_name(text: str) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines[:5]:
        if EMAIL_RE.search(line) or PHONE_RE.search(line) or LINKEDIN_RE.search(line):
            continue
        cleaned = re.sub(r"[^\w\s\.\-]", "", line).strip()
        words = cleaned.split()
        if 2 <= len(words) <= 4 and all(w[0].isupper() or w.isupper() for w in words if w):
            if not any(k in cleaned.lower() for k in ["resume", "curriculum", "vitae", "summary", "page", "profile"]):
                return cleaned
    if lines:
        first = lines[0].strip()
        if len(first.split()) <= 4 and not EMAIL_RE.search(first):
            return first
    return None


def split_into_sections(text: str) -> dict[str, str]:
    lines = text.splitlines()
    matches: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        trimmed = line.strip()
        if not trimmed:
            continue
        for sec_name, pattern in SECTION_HEADINGS.items():
            if pattern.match(trimmed):
                matches.append((i, sec_name))
                break

    sections: dict[str, list[str]] = defaultdict(list)
    if not matches:
        return {"other": text}

    # Header / intro
    sections["header"] = lines[: matches[0][0]]

    for idx, (line_idx, sec_name) in enumerate(matches):
        next_idx = matches[idx + 1][0] if idx + 1 < len(matches) else len(lines)
        body = lines[line_idx + 1 : next_idx]
        sections[sec_name].extend(body)

    return {k: "\n".join(v).strip() for k, v in sections.items()}


def extract_skills_from_text(section_text: str, full_text: str) -> list[str]:
    extracted: list[str] = []
    seen: set[str] = set()

    # 1. From skills section
    if section_text:
        lines = section_text.splitlines()
        for line in lines:
            line = re.sub(r"^[\s•\-\*\d\.\)]+", "", line).strip()
            if not line:
                continue
            parts = re.split(r"[,|•;•]+", line)
            for part in parts:
                cleaned = part.strip()
                if cleaned and 2 <= len(cleaned) <= 45:
                    key = cleaned.lower()
                    if key not in seen:
                        seen.add(key)
                        extracted.append(cleaned)

    # 2. Match common dictionary skills if extracted skills are sparse
    if len(extracted) < 5:
        lower_full = full_text.lower()
        for skill in COMMON_SKILLS:
            pattern = rf"\b{re.escape(skill.lower())}\b"
            if re.search(pattern, lower_full):
                key = skill.lower()
                if key not in seen:
                    seen.add(key)
                    extracted.append(skill)

    return extracted[:25]


def extract_entries_from_section(section_text: str, max_items: int = 8) -> list[str]:
    if not section_text:
        return []
    lines = [line.strip() for line in section_text.splitlines() if line.strip()]
    entries: list[str] = []

    current_entry: list[str] = []
    # Pattern indicating start of a new experience / education entry (dates or job titles)
    entry_start_pattern = re.compile(
        r"^(?:(?:\d{2}\/)?\d{4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|•|\*|\d+\.|\bBachelor|\bMaster|\bAssociate|\bPh\.?D|\bB\.?S|\bB\.?A|\bM\.?S|\bM\.?B\.?A|\bB\.?Tech|\bM\.?Tech)\b",
        re.I,
    )

    for line in lines:
        cleaned_line = re.sub(r"^[\s•\-\*\d\.\)]+", "", line).strip()
        if not cleaned_line:
            continue
        if entry_start_pattern.search(line) and current_entry:
            combined = " ".join(current_entry)
            if len(combined) >= 5:
                entries.append(combined[:200])
            current_entry = [cleaned_line]
        else:
            if not current_entry:
                current_entry.append(cleaned_line)
            else:
                current_entry.append(cleaned_line)

    if current_entry:
        combined = " ".join(current_entry)
        if len(combined) >= 5:
            entries.append(combined[:200])

    # If parsing into blocks didn't yield clean entries, split by lines
    if not entries and lines:
        for line in lines[:max_items]:
            cleaned = re.sub(r"^[\s•\-\*\d\.\)]+", "", line).strip()
            if len(cleaned) >= 5:
                entries.append(cleaned[:200])

    return entries[:max_items]


def extract_curated_resume(text: str) -> dict[str, Any]:
    sections = split_into_sections(text)

    # 1. Basics
    name = extract_full_name(text)
    emails = EMAIL_RE.findall(text)
    email = emails[0].strip() if emails else None

    phones = [p.strip() for p in PHONE_RE.findall(text) if len(re.sub(r"\D", "", p)) >= 10]
    phone = phones[0] if phones else None

    linkedin_m = LINKEDIN_RE.search(text)
    linkedin = linkedin_m.group(0).strip() if linkedin_m else None
    if linkedin and not linkedin.startswith("http"):
        linkedin = f"https://{linkedin}"

    github_m = GITHUB_RE.search(text)
    github = github_m.group(0).strip() if github_m else None
    if github and not github.startswith("http"):
        github = f"https://{github}"

    # 2. Summary
    summary = sections.get("summary")
    if summary:
        summary_lines = [l.strip() for l in summary.splitlines() if l.strip()]
        summary = " ".join(summary_lines)
        if len(summary) > 600:
            summary = summary[:600].rsplit(" ", 1)[0] + "."
    else:
        summary = None

    # 3. Skills
    skills = extract_skills_from_text(sections.get("skills", ""), text)

    # 4. Experience
    experience = extract_entries_from_section(sections.get("experience", ""), max_items=6)

    # 5. Education
    education = extract_entries_from_section(sections.get("education", ""), max_items=4)

    # 6. Projects
    projects = extract_entries_from_section(sections.get("projects", ""), max_items=4)

    # 7. Certifications
    certifications = extract_entries_from_section(sections.get("certifications", ""), max_items=5)

    raw_extraction = {
        "full_name": name,
        "email": email,
        "phone": phone,
        "linkedin": linkedin,
        "github": github,
        "skills": skills,
        "summary": summary,
        "experience": experience,
        "education": education,
        "projects": projects,
        "certifications": certifications,
    }

    return normalize_extraction(raw_extraction)


def main() -> None:
    print("Loading existing reviewed resumes...")
    reviewed_rows: list[dict[str, Any]] = []
    reviewed_ids: set[str] = set()

    with EXISTING_REVIEWED.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                item = json.loads(line)
                reviewed_rows.append(item)
                reviewed_ids.add(item["resume_id"])

    print(f"Loaded {len(reviewed_rows)} existing reviewed resumes.")

    print("Loading manifest and doccano_import.jsonl...")
    manifest: dict[str, dict[str, str]] = {}
    with MANIFEST_PATH.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            manifest[row["text_sha256"]] = row

    candidates: list[dict[str, Any]] = []
    with DOCCANO_IMPORT.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            text = item.get("text", "")
            h = text_hash(text)
            meta = manifest.get(h)
            if meta and meta["resume_id"] not in reviewed_ids:
                candidates.append({
                    "resume_id": meta["resume_id"],
                    "category": meta.get("category", "Uncategorized"),
                    "text": text,
                })

    print(f"Found {len(candidates)} candidate unreviewed resumes.")
    target_count = 200
    if len(candidates) < target_count:
        raise SystemExit(f"Not enough candidates! Found {len(candidates)}, needed {target_count}")

    # Stratify selection evenly across categories
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in candidates:
        by_category[c["category"]].append(c)

    selected: list[dict[str, Any]] = []
    cat_keys = sorted(by_category.keys())
    while len(selected) < target_count:
        for cat in cat_keys:
            if by_category[cat]:
                selected.append(by_category[cat].pop(0))
                if len(selected) == target_count:
                    break

    print(f"Selected exactly {len(selected)} diverse resumes across {len(cat_keys)} categories.")

    print("Extracting structured fields for 200 new resumes...")
    new_rows: list[dict[str, Any]] = []
    for i, item in enumerate(selected, 1):
        extraction = extract_curated_resume(item["text"])
        new_rows.append({
            "resume_id": item["resume_id"],
            "category": item["category"],
            "text": item["text"],
            "extraction": extraction,
            "reviewed": True,
        })
        if i % 50 == 0:
            print(f"  Processed {i}/{target_count} extractions...")

    combined = reviewed_rows + new_rows
    print(f"Writing all {len(combined)} resumes to {OUTPUT_PATH}...")
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="\n") as out:
        for row in combined:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"Successfully created 300-resume dataset at {OUTPUT_PATH}!")


if __name__ == "__main__":
    main()
