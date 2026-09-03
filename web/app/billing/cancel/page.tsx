import Link from "next/link";
import { XCircle } from "lucide-react";

export default function BillingCancelPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-sm text-center max-w-md w-full">
        <XCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Paiement annulé</h2>
        <p className="text-gray-600 mb-6">
          Vous avez annulé le paiement. Aucun montant n'a été prélevé.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors w-full"
        >
          Retour au dashboard
        </Link>
      </div>
    </div>
  );
}
