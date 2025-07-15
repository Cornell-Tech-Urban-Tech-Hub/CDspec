import { z, defineCollection } from 'astro:content';

const projects = defineCollection({
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.date(),
    updatedDate: z.date().optional(),
    thumbnail: image().optional(),
    cdCode: z.string().describe('Community District code (e.g., "101" for Manhattan CD 1)'),
    cdName: z.string().describe('Community District name (e.g., "Lower Manhattan")'),
    borough: z.enum(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false).describe('If true, the project will not be displayed in the public site'),
    tags: z.array(z.string()).default([]),
    
    // ArcGIS StoryMap integration - this is the main content
    storymapUrl: z.string().url().describe('URL to the ArcGIS StoryMap for this community district'),
    
    // Optional metadata
    studentNames: z.array(z.string()).optional().describe('Names of students who created this project'),
    semester: z.string().optional().describe('Academic semester when project was created'),
    courseCode: z.string().optional().describe('Course code (e.g., "PLAN 6420")'),
  }),
});

// Export a single `collections` object to register your collection(s)
export const collections = {
  'projects': projects,
};