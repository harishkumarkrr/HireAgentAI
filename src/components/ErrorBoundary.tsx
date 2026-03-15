import * as React from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const state = (this as any).state;
    const props = (this as any).props;
    
    if (state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      
      try {
        // Check if it's a Firestore permission error (JSON string)
        if (state.error?.message.startsWith('{')) {
          const errInfo = JSON.parse(state.error.message);
          if (errInfo.error.includes('Missing or insufficient permissions')) {
            errorMessage = "You don't have permission to perform this action. Please check your account role.";
          }
        }
      } catch (e) {
        // Fallback to default message
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center space-y-6">
            <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">Something went wrong</h2>
              <p className="text-gray-500">{errorMessage}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 bg-gray-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-gray-800 transition-all mx-auto"
            >
              <RefreshCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return props.children;
  }
}
