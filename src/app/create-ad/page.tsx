import { CreateAdForm } from './CreateAdClient';

export default function CreateAdPage() {
  return (
    <main className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Create P2P Advertisement</h1>
        <p className="text-sm text-muted-foreground mt-1">Post your buy or sell offer to the marketplace</p>
      </div>
      <CreateAdForm />
    </main>
  );
}
