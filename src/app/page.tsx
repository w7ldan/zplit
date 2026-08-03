export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8 sm:px-8 lg:px-12">
        <header className="text-sm font-medium tracking-tight">Zplit</header>
        <section className="flex flex-1 items-center py-20 sm:py-28">
          <div className="max-w-2xl">
            <p className="mb-6 text-sm font-medium text-muted-foreground">
              Personal expense and repayment tracker
            </p>
            <h1 className="text-5xl font-semibold tracking-[-0.04em] sm:text-7xl">Zplit</h1>
            <p className="mt-6 text-2xl font-medium leading-tight tracking-tight sm:text-4xl">
              Keep track of what friends owe you.
            </p>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              A simple foundation for recording shared expenses and keeping repayments clear.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
