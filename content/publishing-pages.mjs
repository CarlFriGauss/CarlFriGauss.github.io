const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const arrow = '<span aria-hidden="true">↗</span>';
const dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const date = value => dateFormat.format(new Date(value));

function essayList(articles) {
  if (!articles.length) return `<div class="empty-state">
    <h3 class="large-serif">The essay collection starts here.</h3>
    <p>Original writing and invited contributions will appear here as they are published.</p>
    <a class="text-link" href="/contributors/">Information for contributors ${arrow}</a>
  </div>`;
  return `<div class="essay-list">${articles.map(article => `<article class="essay-entry">
    <div class="essay-meta"><span>${escape(article.author)}</span><time datetime="${escape(article.published)}">${date(article.published)}</time></div>
    <h3><a href="/essays/${escape(article.slug)}/">${escape(article.title)}</a></h3>
    <p>${escape(article.summary)}</p>
    ${article.tags.length ? `<div class="essay-tags">${article.tags.slice(0, 6).map(tag => `<span>${escape(tag)}</span>`).join('')}</div>` : ''}
  </article>`).join('')}</div>`;
}

function essayPage(article) {
  return {
    path: `essays/${article.slug}`,
    title: article.title,
    description: article.summary,
    author: article.author,
    article: true,
    media: article.html.includes('class="article-video"'),
    nav: 'essays',
    body: `<article class="published-essay">
      <header class="container page-hero essay-heading">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/essays/">Essays</a></nav>
        <h1>${escape(article.title)}</h1>
        <div class="essay-meta"><span>By ${escape(article.author)}</span><time datetime="${escape(article.published)}">${date(article.published)}</time>${article.updated !== article.published ? `<span>Updated ${date(article.updated)}</span>` : ''}</div>
      </header>
      <div class="container section article-body prose">${article.html}</div>
      <footer class="container essay-end"><a class="text-link" href="/essays/">← Back to the essays</a><a class="text-link" href="/contributors/">Contribute ${arrow}</a></footer>
    </article>`,
  };
}

export function publishingPages(articles, config) {
  return [
    {
      path: 'essays',
      title: 'Essays',
      description: 'Independent essays and invited contributions.',
      nav: 'essays',
      body: `<section class="container page-hero">
        <h1>Essays</h1>
        <p class="lede">Independent writing by Carl Friedrich Gauss and invited contributors.</p>
      </section>
      <section class="container section" aria-labelledby="essays-heading">
        <div class="section-head"><h2 id="essays-heading">The collection</h2><a class="text-link" href="/feed.xml">Follow by RSS ${arrow}</a></div>
        ${essayList(articles)}
      </section>`,
    },
    {
      path: 'contributors',
      title: 'Contribute',
      description: 'Propose an essay or open the writing desk for invited contributors.',
      nav: 'essays',
      body: `<section class="container page-hero">
        <h1>Contribute an essay</h1>
        <p class="lede">Share a considered argument, a fresh perspective or an explanation that makes a difficult idea clear.</p>
      </section>
      <section class="container section split" aria-labelledby="contribute-invited">
        <div><h2 id="contribute-invited">Already invited?</h2><p>Open the visual editor to write, save drafts and add public media.</p><a class="button" href="/write/">Open the writing desk ${arrow}</a></div>
        <div><h2>Propose a contribution</h2><p>Send a short note about the subject, the argument you want to develop and the public name you would like to write under.</p><a class="text-link" href="mailto:Carl_Fr_Gauss@proton.me?subject=Writing%20proposal">Send a proposal ${arrow}</a></div>
      </section>`,
    },
    {
      path: 'write',
      title: 'Writing desk',
      description: 'Sign in to the visual publishing dashboard and learn how to publish an essay.',
      nav: 'essays',
      noindex: true,
      body: `<section class="container page-hero">
        <h1>Writing desk</h1>
        <p class="lede">Write an essay, save a draft and add images or video.</p>
      </section>
      <section class="container section writing-desk" aria-labelledby="desk-signin">
        <div class="desk-entry">
          <h2 id="desk-signin">Contributor access</h2>
          <p>Sign in to Blogger with the Google account that received your author invitation.</p>
          <a class="button" href="${escape(config.editorUrl)}" target="_blank" rel="noopener noreferrer">Open the visual editor ${arrow}</a>
          <p class="small-note">Publishes to <a href="/essays/">the essay collection</a>.</p>
        </div>
        <ol class="writing-steps">
          <li><h3>Start a post</h3><p>Choose <strong>New post</strong> and add a title. Write directly in the editor or paste text from a document. Use the toolbar to format it.</p></li>
          <li><h3>Save your draft</h3><p>Check that the editor has saved your changes before closing it. You can reopen the draft from <strong>Posts</strong> and continue later.</p></li>
          <li><h3>Add images or video</h3><p>Choose <strong>Insert image</strong> or <strong>Insert video</strong> and select a file from your computer. Add a description for each informative image.</p></li>
          <li><h3>Preview and publish</h3><p>Choose <strong>Preview</strong> to check your work, then <strong>Publish</strong>. The website checks for updates about every ten minutes. Allow extra time for the build or a delayed check.</p></li>
        </ol>
      </section>
      <section class="container section prose" aria-labelledby="desk-questions">
        <h2 id="desk-questions">Publishing help</h2>
        <div class="faq">
          <details><summary>Which file format should I use for an essay?</summary><p>Write in the visual editor or paste text from Word, Google Docs or another editor. Keep your own copy in whichever format you prefer. The website creates the article page and adds it to the collection automatically.</p></details>
          <details><summary>Who can edit my work?</summary><p>Authors can create, edit and publish their own posts. The owner can manage all posts and invitations.</p></details>
          <details><summary>How do I update or withdraw a published article?</summary><p>Open the post and choose <strong>Update</strong> after editing. Choose <strong>Revert to draft</strong> to withdraw it at the next website update. People may have saved copies of the original publication.</p></details>
          <details><summary>Who can see files I upload?</summary><p>Treat uploads as public. People who have a file’s URL may be able to view it while the post is still a draft. Use separate protected storage for student information or private academy materials.</p></details>
          <details><summary>I accepted an invitation. Where is the publication?</summary><p>Open the editor with the Google account that received the invitation. If you use several accounts, switch to that account in Blogger.</p></details>
          <details><summary>How does the owner invite another author?</summary><p>Open <strong>Settings → Permissions → Invite more authors</strong> in Blogger. Choose the <strong>Author</strong> role. Reserve administrator access for managing the publication.</p></details>
          <details><summary>How do I choose my public name?</summary><p>Set your display name in your Blogger profile before publishing. Check your article, captions and uploads for personal information. The site uses your public byline.</p></details>
        </div>
        <p><a class="text-link" href="/privacy/">Read the privacy notice <span aria-hidden="true">→</span></a></p>
      </section>`,
    },
    ...articles.map(essayPage),
  ];
}
