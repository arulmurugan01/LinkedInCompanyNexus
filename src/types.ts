// types.ts

export interface CompanyData {
    company_url: string | null;
    company_name: string | null;
    company_logo: string | null;
    followers: string | null;
    industry: string | null;
    employee_count: string | null;
    linkedin_employees: string | null;
    about: string | null;
}

export interface JobData {
    job_id: string | null;
    job_title: string | null;
    job_url: string | null;

    // Basic company fields (from job card / header)
    company_name: string | null;
    company_logo: string | null;

    // Enriched company section
    company: CompanyData | null;

    location: string | null;
    posted_date: string | null;
    total_applicants: string | null;
    job_type_pills: string[];
    apply_type: string | null;
    about_job: { heading: string | null; content: string[] }[];
    page_number: number;
}

export interface ScrapeOptions {
    searchUrl: string;
    maxPages?: number;   // optional — omit or set to 0 for unlimited
}