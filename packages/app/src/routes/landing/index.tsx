/**
 * Landing page ("/") — the public front door.
 *
 * Design matches the Somaiya mockup:
 * - Somaiya brand navbar
 * - Hero with soft pink gradient, badge, bold heading, two CTA buttons
 * - Features strip below the fold
 */
import { Link } from 'react-router-dom';
import { LandingNav } from '../../components/LandingNav';
import { Sparkles, Code2, Play, BookOpen, Users, Shield, Cpu, Activity } from 'lucide-react';

const FEATURES = [
  {
    icon: Code2,
    title: 'Lexical Analysis',
    desc: 'Input source code and watch the compiler tokenize it instantly. Understand how keywords, identifiers, and symbols are recognized.',
  },
  {
    icon: Activity,
    title: 'Syntax Parsing',
    desc: 'Visualize Abstract Syntax Trees (AST). See how your code\'s structure is validated against formal grammar rules step-by-step.',
  },
  {
    icon: Cpu,
    title: 'Intermediate Representation',
    desc: 'Dive deep into three-address code (TAC) and control flow graphs. See the bridge between high-level code and machine instructions.',
  },
  {
    icon: Users,
    title: 'Built for KJSIEIT Students',
    desc: 'Exercises, graded labs and examples curated for the Compiler Construction curriculum at K J Somaiya Institute of Technology.',
  },
  {
    icon: Shield,
    title: 'Secure Somaiya Login',
    desc: 'Access is restricted to @somaiya.edu accounts, keeping your lab environment private and institution-grade.',
  },
  {
    icon: Sparkles,
    title: 'Modern Learning Interface',
    desc: 'A clean, responsive tool that gets out of your way so you can focus on mastering compiler design.',
  },
];

export default function LandingRoute() {
  return (
    <div className="flex min-h-dvh flex-col bg-white font-inter">
      <LandingNav />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-20 text-center sm:py-28"
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
               backgroundImage: 'radial-gradient(circle at 15% 50%, rgba(139, 0, 0, 0.04) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139, 0, 0, 0.04) 0%, transparent 50%)',
             }}
        />

        {/* Welcome badge */}
        <div className="mb-6 inline-flex animate-slide-up items-center gap-2 rounded-full border border-somaiya/20 bg-somaiya-light/50 px-4 py-1.5 backdrop-blur-sm" style={{ animationDelay: '0ms' }}>
          <Sparkles className="size-4 text-somaiya" aria-hidden />
          <span className="text-sm font-medium text-somaiya">
            Welcome to Compiler Virtual Lab
          </span>
        </div>

        {/* Main heading */}
        <h1 className="mb-5 max-w-3xl animate-slide-up text-balance text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl" style={{ animationDelay: '100ms', opacity: 0 }}>
          Transform source code
          <br />
          into{' '}
          <span className="bg-gradient-to-r from-somaiya to-somaiya-dark bg-clip-text text-transparent">Executable Magic</span>
        </h1>

        {/* Subheading */}
        <p className="mb-10 max-w-xl animate-slide-up text-balance text-base text-gray-500 sm:text-lg" style={{ animationDelay: '200ms', opacity: 0 }}>
          Watch compilation happen step-by-step. From lexical analysis to code generation, explore the inner workings of a modern compiler directly in your browser.
        </p>

        {/* CTAs */}
        <div className="flex animate-slide-up flex-wrap items-center justify-center gap-4" style={{ animationDelay: '300ms', opacity: 0 }}>
          <Link
            to="/login"
            className="group relative flex items-center gap-2 overflow-hidden rounded-full bg-somaiya px-8 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-somaiya-dark hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-somaiya focus-visible:ring-offset-2"
          >
            <span>Start Building</span>
            <Play className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            to="/about"
            className="rounded-full border-2 border-somaiya px-8 py-3 text-sm font-semibold text-somaiya transition-all hover:bg-somaiya/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-somaiya focus-visible:ring-offset-2"
          >
            Learn More
          </Link>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="bg-white px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 animate-slide-up text-center" style={{ animationDelay: '400ms', opacity: 0 }}>
            <h2 className="mb-3 text-3xl font-bold text-gray-900">
              Everything you need to master Compilers
            </h2>
            <p className="mx-auto max-w-xl text-gray-500">
              An all-in-one virtual lab built to support your Systems Programming and Compiler Construction coursework at KJSIEIT.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }, idx) => (
              <div
                key={title}
                className="group animate-slide-up rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-somaiya/20 hover:shadow-md"
                style={{ animationDelay: `${500 + idx * 100}ms`, opacity: 0 }}
              >
                <div className="mb-4 inline-flex rounded-xl bg-somaiya-light p-3 transition-colors group-hover:bg-somaiya/10">
                  <Icon className="size-6 text-somaiya" aria-hidden />
                </div>
                <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ───────────────────────────────────────────────────── */}
      <section className="bg-somaiya px-4 py-20 text-center">
        <h2 className="mb-4 text-3xl font-bold text-white">
          Ready to start your learning journey?
        </h2>
        <p className="mb-8 text-base text-white/80">
          Sign in with your @somaiya.edu account to access the full lab.
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
