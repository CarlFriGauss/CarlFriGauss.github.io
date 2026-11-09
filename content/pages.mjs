const contact = 'mailto:Carl_Fr_Gauss@proton.me';

const pageHero = (eyebrow, title, lede) => `
  <section class="container page-hero">
    <p class="eyebrow">${eyebrow}</p>
    <h1 class="large-serif">${title}</h1>
    <p class="lede">${lede}</p>
  </section>`;

const courseBody = ({ number, title, introduction, question, modules }) => `
  <section class="container page-hero">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/academy/">Academy</a><span aria-hidden="true"> / </span><span>${title}</span>
    </nav>
    <p class="eyebrow">Academy · Field ${number}</p>
    <h1 class="large-serif">${title}</h1>
    <p class="lede">${introduction}</p>
    <p class="status">In development</p>
  </section>
  <section class="container section course-layout" aria-labelledby="course-outline">
    <div>
      <div class="section-head">
        <div>
          <p class="eyebrow">A proposed direction</p>
          <h2 id="course-outline">${question}</h2>
        </div>
      </div>
      <p class="muted">These are proposed areas of study. The course structure, prerequisites, and lesson sequence are still being developed.</p>
      <div class="module-list">
        ${modules.map((module, index) => `
        <article class="module">
          <div><h3>${module.title}</h3><p>${module.text}</p></div>
        </article>`).join('')}
      </div>
    </div>
    <aside class="course-sidebar" aria-labelledby="course-status">
      <p class="eyebrow">Course status</p>
      <h2 id="course-status">Taking shape.</h2>
      <p>Enrollment is not open. This page describes the intended teaching direction.</p>
      <p>Course materials, lesson previews, and any subscription details will be published when they are ready.</p>
      <a class="text-link" href="${contact}?subject=Academy%20inquiry">Ask about the academy <span aria-hidden="true">↗</span></a>
    </aside>
  </section>
  <section class="container section" aria-labelledby="course-learning">
    <div class="section-head">
      <div><p class="eyebrow">The intended experience</p><h2 id="course-learning">A course with room to think.</h2></div>
    </div>
    <div class="grid-three">
      <article class="card"><h3>Lessons &amp; materials</h3><p>Recorded explanations, written notes, and problems are planned for a dedicated course workspace.</p></article>
      <article class="card"><h3>Live board sessions</h3><p>Interactive teaching is planned around a digital writing board, with questions and discussion during class.</p></article>
      <article class="card"><h3>A course discussion</h3><p>A separate student forum is planned for each course, with space for questions, shared reasoning, and instructor replies.</p></article>
    </div>
    <p class="note">These academy features are planned and are not available on the current public site.</p>
  </section>
  <section class="container section split" aria-labelledby="course-explore">
    <div><p class="eyebrow">Explore now</p><h2 id="course-explore">See an idea take shape.</h2><p>The free Gaussian process explorer is already available in your browser. Add observations and investigate how a model responds.</p></div>
    <div><a class="button button-secondary" href="/tools/gaussian-process/">Open the explorer <span aria-hidden="true">↗</span></a><p><a class="text-link" href="/academy/">Back to the academy <span aria-hidden="true">→</span></a></p></div>
  </section>`;

export const pages = [
  {
    path: 'essays',
    title: 'Essays',
    description: 'Independent writing by Carl Friedrich Gauss. A home for considered arguments, open inquiry, and future guest contributions.',
    nav: 'essays',
    body: `${pageHero('Writing & inquiry', 'Give an idea the room it deserves.', 'An independent home for considered arguments, clear explanations, and questions worth staying with.')}
      <section class="container section" aria-labelledby="essays-status">
        <div class="section-head"><div><span class="section-index" aria-hidden="true">01 /</span><h2 id="essays-status">The essays</h2></div><p class="meta">Carl Friedrich Gauss</p></div>
        <div class="empty-state">
          <p class="eyebrow">The beginning of a collection</p>
          <h3 class="large-serif">The first essays are in preparation.</h3>
          <p>Nothing has been published here yet. This space will hold original writing by Carl Friedrich Gauss and, in time, invited contributions.</p>
          <a class="text-link" href="/about/">Read about the project <span aria-hidden="true">→</span></a>
        </div>
      </section>
      <section class="container section" aria-labelledby="essays-principles">
        <div class="section-head"><div><span class="section-index" aria-hidden="true">02 /</span><h2 id="essays-principles">An editorial intention.</h2></div></div>
        <div class="grid-three principles">
          <article class="card"><h3>Make the argument.</h3><p>Give a claim its reasoning, context, and room for examination.</p></article>
          <article class="card"><h3>Keep asking.</h3><p>Follow questions across mathematics, ideas, and the way we understand the world.</p></article>
          <article class="card"><h3>Let ideas meet.</h3><p>Make space for differing views and disagreement addressed on its merits.</p></article>
        </div>
      </section>
      <section class="container section split" aria-labelledby="essays-contribute">
        <div><p class="eyebrow">Other voices</p><h2 id="essays-contribute">A serious idea to share?</h2><p>Guest contributions are part of the plan. If you have an essay in mind, start with a short proposal.</p></div>
        <div><a class="button button-secondary" href="/contributors/">For contributors <span aria-hidden="true">→</span></a></div>
      </section>`,
  },
  {
    path: 'academy',
    title: 'Academy',
    description: 'A mathematics academy in development: rigorous lessons in mathematics, probability, and statistics, with plans for live teaching and course discussions.',
    nav: 'academy',
    body: `${pageHero('The academy', 'Understand what holds the ideas together.', 'Mathematics, probability, and statistics taught with care: the reasoning, the intuition, and the work of making an idea your own.')}
      <section class="container section" aria-labelledby="academy-fields">
        <div class="section-head"><div><span class="section-index" aria-hidden="true">01 /</span><h2 id="academy-fields">Three connected fields.</h2></div><p class="status">Academy in development</p></div>
        <p class="muted">The outlines below describe the proposed direction. Courses and subscriptions are not open for enrollment.</p>
        <div class="grid-three">
          <article class="card course-card">
            <span class="course-number" aria-hidden="true">01</span><p class="eyebrow">Structure &amp; proof</p><h3>Mathematics</h3><p>Build a precise way of thinking about functions, change, linear structure, and proof.</p><p class="status">In development</p><a class="text-link" href="/academy/mathematics/" aria-label="Explore the mathematics outline">Explore the outline <span aria-hidden="true">→</span></a>
          </article>
          <article class="card course-card">
            <span class="course-number" aria-hidden="true">02</span><p class="eyebrow">Chance &amp; uncertainty</p><h3>Probability</h3><p>Connect random events, conditional reasoning, distributions, and the behavior of uncertainty.</p><p class="status">In development</p><a class="text-link" href="/academy/probability/" aria-label="Explore the probability outline">Explore the outline <span aria-hidden="true">→</span></a>
          </article>
          <article class="card course-card">
            <span class="course-number" aria-hidden="true">03</span><p class="eyebrow">Evidence &amp; inference</p><h3>Statistics</h3><p>Learn how assumptions, models, and data work together when drawing a conclusion.</p><p class="status">In development</p><a class="text-link" href="/academy/statistics/" aria-label="Explore the statistics outline">Explore the outline <span aria-hidden="true">→</span></a>
          </article>
        </div>
      </section>
      <section class="container section split" aria-labelledby="academy-method">
        <div><p class="eyebrow">The teaching approach</p><h2 id="academy-method">A board. A question. Time to work.</h2><p class="lede">The academy is planned to bring recorded lessons and live, interactive teaching into the same course experience.</p></div>
        <div class="prose"><p>Live classes are intended to use a digital writing board so that an argument can unfold one step at a time. Students will be able to ask questions, and teachers will be able to teach with their camera off.</p><p>Each course is intended to have its own materials, recordings, and discussion forum, where students can compare approaches and receive instructor replies.</p><p>Some lessons are intended to be freely available as previews. The paid teaching platform, subscriptions, and student accounts are still being planned.</p></div>
      </section>
      <section class="container section" aria-labelledby="academy-free">
        <div class="split card"><div><p class="eyebrow">Available now · Free</p><h2 id="academy-free">Explore Gaussian processes.</h2><p>Add a few observations. Change the assumptions. Watch the prediction and its uncertainty respond.</p><p class="muted">An interactive browser tool, open to everyone.</p></div><div><a class="button" href="/tools/gaussian-process/">Start exploring <span aria-hidden="true">↗</span></a></div></div>
      </section>
      <section class="container section" aria-labelledby="academy-questions">
        <div class="section-head"><div><p class="eyebrow">A few practical details</p><h2 id="academy-questions">Before the first course.</h2></div></div>
        <div class="faq">
          <details><summary>When can I enroll?</summary><p>The academy is in development. There is no enrollment date or subscription offer yet. Course details will be published here when they are ready.</p></details>
          <details><summary>Will there be free lessons?</summary><p>Yes, the plan includes selected free lessons so that you can experience the teaching before deciding whether to subscribe. No academy lessons have been published yet; the Gaussian process explorer is available now.</p></details>
          <details><summary>Will I be able to ask questions?</summary><p>The planned format includes interactive live classes and a separate forum for each course, with student discussions and instructor replies.</p></details>
          <details><summary>How can I get in touch?</summary><p>For an academy inquiry, email <a href="${contact}?subject=Academy%20inquiry">Carl_Fr_Gauss@proton.me</a>.</p></details>
        </div>
      </section>`,
  },
  {
    path: 'academy/mathematics',
    title: 'Mathematics · Academy',
    description: 'The proposed mathematics teaching direction: reasoning and proof, functions and change, linear algebra, and mathematical structure. In development.',
    nav: 'academy',
    body: courseBody({
      number: '01',
      title: 'Mathematics',
      introduction: 'A precise language for structure, change, and the arguments that connect them.',
      question: 'From an example to an understanding.',
      modules: [
        { title: 'Reasoning & proof', text: 'Definitions, logical structure, and the role of examples and counterexamples in building a mathematical argument.' },
        { title: 'Functions & change', text: 'Functions, limits, derivatives, and integrals, with attention to the ideas that make the notation meaningful.' },
        { title: 'Linear structure', text: 'Vectors, transformations, systems of equations, and the geometry behind linear algebra.' },
        { title: 'Connections & abstraction', text: 'Recognizing shared structure across problems and learning when a more general point of view becomes useful.' },
      ],
    }),
  },
  {
    path: 'academy/probability',
    title: 'Probability · Academy',
    description: 'The proposed probability teaching direction: events, conditioning, random variables, distributions, and the behavior of uncertainty. In development.',
    nav: 'academy',
    body: courseBody({
      number: '02',
      title: 'Probability',
      introduction: 'A framework for reasoning carefully when outcomes are uncertain.',
      question: 'Give uncertainty a mathematical form.',
      modules: [
        { title: 'Events & probability', text: 'Sample spaces, events, and the rules that turn informal statements about chance into precise questions.' },
        { title: 'Conditioning & independence', text: 'How information changes a probability, what independence means, and how conditional reasoning works.' },
        { title: 'Random variables & distributions', text: 'Discrete and continuous models, expectation, variation, and ways to describe the shape of uncertainty.' },
        { title: 'Many observations', text: 'The ideas behind limit behavior, simulation, and the connection between individual random outcomes and larger patterns.' },
      ],
    }),
  },
  {
    path: 'academy/statistics',
    title: 'Statistics · Academy',
    description: 'The proposed statistics teaching direction: data, modeling, estimation, uncertainty, and inference. In development.',
    nav: 'academy',
    body: courseBody({
      number: '03',
      title: 'Statistics',
      introduction: 'Learn to ask what data can tell us, and what a conclusion depends on.',
      question: 'Follow the reasoning from data to inference.',
      modules: [
        { title: 'Data & the question', text: 'How observations are obtained, what is being measured, and how the question shapes an analysis.' },
        { title: 'Models & assumptions', text: 'Statistical models, their assumptions, and the relationship between a useful simplification and the data it describes.' },
        { title: 'Estimation & uncertainty', text: 'Estimators, sampling variation, and ways of expressing the uncertainty around a numerical answer.' },
        { title: 'Inference & interpretation', text: 'Evaluating evidence, comparing explanations, and communicating conclusions with their conditions and limits.' },
      ],
    }),
  },
  {
    path: 'contributors',
    title: 'For contributors',
    description: 'Propose a guest essay for the independent writing project of Carl Friedrich Gauss. Guest publication is being planned.',
    nav: 'essays',
    body: `${pageHero('For contributors', 'Bring a thought of your own.', 'Guest essays are part of the plan: independent voices, clear arguments, and ideas that reward a closer look.')}
      <section class="container section split" aria-labelledby="contributors-proposal">
        <div><p class="eyebrow">Start a conversation</p><h2 id="contributors-proposal">An idea before a manuscript.</h2><p class="lede">If you would like to contribute, send a short proposal explaining the question you want to explore and the argument you hope to make.</p></div>
        <div class="prose"><p>This collection is just beginning. No guest essays have been published, and there is no automated submission system.</p><p>Publication arrangements, editorial discussion, and your preferred public byline will be agreed directly before a contribution appears.</p><a class="button" href="${contact}?subject=Guest%20essay%20proposal">Propose an essay <span aria-hidden="true">↗</span></a></div>
      </section>
      <section class="container section" aria-labelledby="contributors-include">
        <div class="section-head"><div><p class="eyebrow">A useful first note</p><h2 id="contributors-include">Give the idea a clear beginning.</h2></div></div>
        <div class="list-rows">
          <div class="list-row"><span class="course-number" aria-hidden="true">01</span><div><h3>The central question</h3><p>What do you want the reader to consider, understand, or reconsider?</p></div></div>
          <div class="list-row"><span class="course-number" aria-hidden="true">02</span><div><h3>The shape of the argument</h3><p>A short outline is enough to begin, with relevant sources or context if you have them.</p></div></div>
          <div class="list-row"><span class="course-number" aria-hidden="true">03</span><div><h3>Your public byline</h3><p>Include the name you would prefer readers to see and any previous work you choose to share.</p></div></div>
        </div>
      </section>
      <section class="container section split" aria-labelledby="contributors-project">
        <div><h2 id="contributors-project">Get to know the project.</h2><p>Read about the purpose of this independent space and the mathematics academy taking shape alongside it.</p></div>
        <div><a class="text-link" href="/about/">About the project <span aria-hidden="true">→</span></a><p><a class="text-link" href="/essays/">Visit the essays <span aria-hidden="true">→</span></a></p></div>
      </section>`,
  },
  {
    path: 'about',
    title: 'About',
    description: 'An independent home for essays and rigorous mathematical learning, published under the pen name Carl Friedrich Gauss.',
    nav: 'about',
    body: `${pageHero('About this place', 'A home for independent thought.', 'Writing and mathematics share an invitation: look closely, follow the reasoning, and arrive at an understanding of your own.')}
      <section class="container section split" aria-labelledby="about-project">
        <div><p class="eyebrow">The project</p><h2 id="about-project">Two pursuits. One place.</h2></div>
        <div class="prose"><p>This website is an independent publishing project by Carl Friedrich Gauss. Its writing section is intended for original essays and, in time, contributions from other thinkers.</p><p>Alongside the essays, a mathematics academy is taking shape. The aim is rigorous teaching in mathematics, probability, and statistics, supported by recorded explanations, live digital-board classes, and course discussions.</p><p>The public site is at the beginning of that work. The first essays are in preparation, the academy is in development, and the free Gaussian process explorer is available now.</p></div>
      </section>
      <section class="container section split" aria-labelledby="about-name">
        <div><p class="eyebrow">On the name</p><h2 id="about-name">Carl Friedrich Gauss is a pen name.</h2></div>
        <div class="prose"><p>The author of this contemporary project writes under the pen name Carl Friedrich Gauss.</p><p>The historical portrait used on this site depicts the mathematician. Today's writing and teaching project are the work of a present-day author using that name.</p></div>
      </section>
      <section class="container section" aria-labelledby="about-values">
        <div class="section-head"><div><p class="eyebrow">What guides the work</p><h2 id="about-values">Clarity. Depth. Independence.</h2></div></div>
        <div class="grid-three principles">
          <article class="card"><h3>Follow the reasoning.</h3><p>Make room for the definitions, assumptions, and steps that give an argument its force.</p></article>
          <article class="card"><h3>Keep the question open.</h3><p>Approach ideas with curiosity and give thoughtful disagreement a place in the conversation.</p></article>
          <article class="card"><h3>Build with care.</h3><p>Develop a lasting home for writing and a considered learning experience, one useful piece at a time.</p></article>
        </div>
      </section>
      <section class="container section split" aria-labelledby="about-contact">
        <div><p class="eyebrow">Correspondence</p><h2 id="about-contact">A note, a question, an idea.</h2><p>For writing, guest proposals, or academy inquiries, use the public contact address.</p></div>
        <div><a class="text-link" href="${contact}">Carl_Fr_Gauss@proton.me <span aria-hidden="true">↗</span></a><p><a class="text-link" href="/contributors/">Information for contributors <span aria-hidden="true">→</span></a></p></div>
      </section>`,
  },
  {
    path: 'privacy',
    title: 'Privacy',
    description: 'How this public static website handles browser preferences, the Gaussian process explorer, hosting requests, and email contact.',
    nav: 'about',
    body: `${pageHero('Privacy', 'A small site. A clear account.', 'This notice describes the public website as it works today. The planned academy will need a separate notice before collecting student information.')}
      <section class="container section course-layout" aria-labelledby="privacy-current">
        <div class="prose">
          <p class="meta">Last updated 9 November 2026</p>
          <h2 id="privacy-current">The current public site</h2>
          <p>This is a public static website. It has no visitor accounts, enrollment system, checkout, payment collection, or submission forms. The website's own code does not add analytics or set cookies.</p>
          <h2>Theme preference</h2>
          <p>If you choose a light or dark theme, the site can save that choice in this browser's local storage so your preferred appearance returns on a later visit. This is a display preference, not a visitor profile. You can remove it through your browser's site-data settings.</p>
          <h2>The Gaussian process explorer</h2>
          <p>The explorer calculates in your browser. Points you add are held in the page's memory and reset when the page reloads. The site's code does not send those points to a server or save them in browser storage.</p>
          <h2>Hosting and technical requests</h2>
          <p>Your browser requests the pages and assets needed to display this site. GitHub, the hosting provider, may process technical request information, including your IP address. Its handling of that information is described in the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub General Privacy Statement</a>.</p>
          <h2>Email contact</h2>
          <p>Email links ask your browser to open your configured mail application. Clicking a link does not send a message. If you choose to email the public address, your message and the details you include are handled through the email services involved. Please share only what is needed for your inquiry.</p>
          <h2>The future academy</h2>
          <p>Student accounts, subscriptions, private course materials, and forums are planned features. They are not active on this public site. Before student information or payments are collected, the academy will need its own privacy information describing the services used, the information required, and how it is handled.</p>
          <h2>Questions</h2>
          <p>For a question about this website, email <a href="${contact}?subject=Website%20privacy%20question">Carl_Fr_Gauss@proton.me</a>.</p>
        </div>
        <aside class="course-sidebar" aria-labelledby="privacy-glance">
          <p class="eyebrow">At a glance</p>
          <h2 id="privacy-glance">The essentials.</h2>
          <ul class="principles"><li>Public pages without sign-in.</li><li>No analytics or cookies added by the site's code.</li><li>An optional theme preference saved in your browser.</li><li>Explorer points stay in page memory.</li><li>Hosting providers may process technical requests.</li></ul>
          <a class="text-link" href="/about/">About the project <span aria-hidden="true">→</span></a>
        </aside>
      </section>`,
  },
];
