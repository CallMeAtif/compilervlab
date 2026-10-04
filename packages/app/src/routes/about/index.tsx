import { Link } from 'react-router-dom';
import { SiteHeader } from '../../components/site/SiteHeader';
import { SiteFooter } from '../../components/site/SiteFooter';

export default function AboutRoute() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas font-inter">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <section className="mx-auto max-w-[84rem] px-4 pt-12 pb-12 sm:px-6 sm:pt-20 sm:pb-16">
          <div className="mx-auto w-full max-w-[64rem]">
            <h1 className="site-display mb-8">About Us</h1>
            
            <h2 className="site-heading mt-8 mb-4">About Somaiya Vidyavihar</h2>
            <div className="site-prose space-y-4">
              <p>Padmabhushan Shri Karamshi Jethabhai Somaiya founded Somaiya Vidyavihar an education trust in 1959, to provide quality holistic education. It was founded on the belief that, education is an important pillar of nation building with the power to change lives, and that it is the duty of the privileged to help provide it to whoever aspires to be educated.</p>
              <p>Somaiya Vidyavihar (SVV) encompasses 34 institutions, with more than 39,000 students and 1,500 faculty. Its educational institutes are spread across two main campuses - a 50 acre complex in Vidyavihar and a 28 acre complex in Sion both located in the heart of Mumbai besides a number of smaller campuses across rural Maharashtra, Karnataka and Gujarat. SVV offers Degree, Diploma &amp; Certificate courses at Undergraduate, Post Graduate and Doctoral levels. Somaiya Vidyavihar also runs a few autonomous Post-Graduate Courses, Vocational Training Courses and High Schools.</p>
              <p>Somaiya Vidyavihar fosters an ecosystem that excels in education, research and service, a place where knowledge is preserved, disseminated and new knowledge is created. It is known as much for its Science, Technology, Medicine, Engineering, Management, Social Sciences and Commerce programs, as for its programs for academic studies in various Faiths and Cultures of India. Shri. Samir Somaiya, a Cornel University and Harvard Business School alumnus is the President of Somaiya Vidyavihar. For more details, visit <a href="https://kjsit.somaiya.edu/en" target="_blank" rel="noreferrer" className="text-somaiya underline">kjsit.somaiya.edu/en</a></p>
            </div>

            <h2 className="site-heading mt-12 mb-4">About K. J. Somaiya Institute of Technology, Sion</h2>
            <div className="site-prose space-y-4">
              <p>The K. J. Somaiya Institute of Technology (KJSIT), was established by the Somaiya Trust in the year 2001 at Ayurvihar campus, Sion. The institute was set up primarily in response to the need for imparting quality education in the modern field of Information Technology and the allied branches of Engineering and Technology. The College is housed in a G+8 storeyed building and in International Standard of Riturang building with airy classrooms, hi-tech laboratories, auditorium, canteen, common rooms etc.</p>
            </div>

            <h2 className="site-heading mt-12 mb-4">Vision of the Institute</h2>
            <div className="site-prose space-y-4">
              <p>⫸ To emerge as a synonym of quality, excellence and commitment in the field of engineering education by unlocking potential, nurturing talent and transforming young minds to create future ready engineers.</p>
            </div>

            <h2 className="site-heading mt-12 mb-4">Mission of the Institute</h2>
            <div className="site-prose space-y-4">
              <p>⫸ To provide students with a thorough knowledge of engineering to refine their professional skills.</p>
              <p>⫸ To nurture creativity and innovation while encouraging multidisciplinary interaction.</p>
              <p>⫸ To train students to be industry ready and capable of working effectively as an individual and in team.</p>
              <p>⫸ To inculcate ethical behaviour, responsibility and commitment among students.</p>
            </div>

            <h2 className="site-heading mt-12 mb-4">Quality Policy</h2>
            <div className="site-prose space-y-4">
              <p>⫸ To conform to the requirements of regulatory authorities viz. AICTE, DTE and University of Mumbai.</p>
              <p>⫸ To maintain transparency and fair practices in admission and recruitment processes.</p>
              <p>⫸ To ensure continuous evaluation and examination process.</p>
              <p>⫸ To ensure best academic ambience by providing high-end equipment in the laboratories, computers, learning resources and smart classrooms.</p>
              <p>⫸ To ensure a safe and secure environment for all stakeholders.</p>
              <p>⫸ To promote industry institute interaction, research &amp; development, placements, technical, co-curricular and extracurricular activities.</p>
            </div>

            <h2 className="site-heading mt-12 mb-4">Objectives</h2>
            <div className="site-prose space-y-4">
              <p>⫸ To focus on persistent improvement in processes related to teaching, learning and evaluation and to promote a culture of research and development among staff and students.</p>
              <p>⫸ To develop technical and interpersonal skills so that the students translate knowledge into action contributing to the benefit of the society.</p>
              <p>⫸ To enhance the learning experience of students by honing versatility through diverse activities.</p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
