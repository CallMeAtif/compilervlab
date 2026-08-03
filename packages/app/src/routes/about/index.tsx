/**
 * About page ("/about") — describes the Compiler Virtual Lab project.
 */
import { Link } from 'react-router-dom';
import { LandingNav } from '../../components/LandingNav';
import { Database, BookOpen, Target, GraduationCap, Code2, Layers, Cpu, Play } from 'lucide-react';

const SECTIONS = [
  {
    icon: Target,
    title: 'Our Mission',
    body: `Compiler Virtual Lab was built to bridge the gap between textbook theory and practical compiler construction. 
           Our goal is to give every KJSIEIT student an always-available, zero-setup environment where they 
           can experiment with grammar rules, write syntax, and see exactly how a compiler processes 
           source code — step by step.`,
  },
  {
    icon: GraduationCap,
    title: "Who it's For",
    body: `This lab is purpose-built for students enrolled in the Systems Programming and Compiler Construction course at 
           K J Somaiya Institute of Technology. Access is restricted to @somaiya.edu accounts so the 
           environment stays focused, institution-grade, and safe for academic use.`,
  },
  {
    icon: Layers,
    title: 'What You Can Do',
    body: `Write code and trace it through the entire compilation pipeline. Explore lexical analysis, 
           abstract syntax trees, intermediate representations, and target code generation — all from a clean, 
           responsive interface. No installation, no configuration, no waiting.`,
  },
  {
    icon: Code2,
    title: 'How it Works',
    body: `The lab runs entirely in the browser using a modular compilation engine. Your code 
           never leaves your machine during execution. Authentication is handled securely by Firebase, 
           ensuring only verified Somaiya accounts can access the platform.`,
  },
  {
    icon: BookOpen,
    title: 'Curriculum Alignment',
    body: `Exercises and examples are curated to align with the SPCC syllabus at KJSIEIT. Topics include 
           Lexical Analysis, LL(1)/LR(1) Parsing, Semantic Analysis, Syntax-Directed Translation, 
           Three-Address Code (TAC), and Code Optimization techniques.`,
  },
  {
    icon: Cpu,
    title: 'Technology',
    body: `Built with React 19, Vite, Tailwind CSS, and Zustand. The parser heavily utilizes graph rendering 
           tools to visualize complex trees and data flows deterministically. The codebase is 
           open to KJSIEIT faculty for review and extension.`,
  },
];

export default function AboutRoute() {
  return (
    <div className="flex min-h-dvh flex-col bg-white font-inter">
      <LandingNav />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden px-4 py-20 text-center"
      >
        {/* Animated Background Mesh/Gradient */}
        <div 
          className="absolute inset-0 -z-10 opacity-60" 
          style={{
            background: 'radial-gradient(circle at 50% 0%, #fdf2f2 0%, #ffffff 70%)',
          }} 
        />
        <div className="absolute inset-0 -z-10 animate-fade-in opacity-40"
             style={{
               backgroundImage: 'radial-gradient(circle at 85% 50%, rgba(139, 0, 0, 0.04) 0%, transparent 50%), radial-gradient(circle at 15% 30%, rgba(139, 0, 0, 0.04) 0%, transparent 50%)',
             }}
        />

        <div className="mx-auto max-w-3xl">
          <span className="mb-5 inline-block animate-slide-up rounded-full border border-somaiya/20 bg-somaiya-light/50 px-4 py-1.5 text-sm font-medium text-somaiya backdrop-blur-sm" style={{ animationDelay: '0ms' }}>
            About the Project
          </span>
          <h1 className="mb-5 animate-slide-up text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl" style={{ animationDelay: '100ms', opacity: 0 }}>
            Compiler Virtual Lab
          </h1>
          <p className="animate-slide-up text-lg text-gray-500" style={{ animationDelay: '200ms', opacity: 0 }}>
            An interactive, browser-based compiler learning environment for students at{' '}
            <span className="font-semibold text-gray-700">
              K J Somaiya Institute of Technology
            </span>.
          </p>
        </div>
      </section>

      {/* ── Sections ──────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2">
          {SECTIONS.map(({ icon: Icon, title, body }, idx) => (
            <div key={title} className="flex animate-slide-up flex-col gap-4" style={{ animationDelay: `${300 + idx * 100}ms`, opacity: 0 }}>
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-somaiya-light">
                  <Icon className="size-5 text-somaiya" aria-hidden />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              </div>
              <p className="text-sm leading-relaxed text-gray-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Institute info ────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50 px-4 py-14 text-center">
        <p className="text-sm text-gray-500">
          Developed for and by{' '}
          <span className="font-semibold text-gray-700">
            K J Somaiya Institute of Technology, Somaiya Vidyavihar University
          </span>
          <br />
          Vidyavihar (E), Mumbai 400077, India.
        </p>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="bg-somaiya px-4 py-20 text-center">
        <h2 className="mb-4 text-3xl font-bold text-white">Ready to dive in?</h2>
        <p className="mb-8 text-base text-white/80">
          Sign in with your @somaiya.edu account to start your first lab session.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-somaiya shadow-lg transition-all hover:scale-105 hover:bg-gray-50 hover:shadow-xl"
        >
          Get Started
          <Play className="size-4" />
        </Link>
      </section>
    </div>
  );
}
