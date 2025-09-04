import { useEffect, useCallback } from 'react';

import useSWR from 'swr';

import useIsLoggedIn from './useIsLoggedIn';

import { useAuthContext } from '@/contexts/AuthContext';
import { logErrorToSentry, addSentryBreadcrumb } from '@/lib/sentry';
import { AuthState } from '@/types/auth/AuthState';
import { AuthError } from '@/types/auth/errorTypes';
import UserProfile from '@/types/auth/UserProfile';
import { getUserProfile, isTokenRefreshInProgress } from '@/utils/auth/api';
import { makeUserProfileUrl } from '@/utils/auth/apiPaths';
import { classifyError } from '@/utils/auth/errors';

export interface UseAuthDataReturn extends AuthState {
  /** User profile data (when available) */
  userData?: UserProfile;
  /** Error from data fetching (if any) */
  userDataError: AuthError;
  /** Function to refresh user data */
  refreshUserData: () => Promise<UserProfile | null>;
}

/**
 * Authentication data hook with SWR integration
 * Provides authentication state and user data management
 * @returns {UseAuthDataReturn} Authentication data and state
 */
const useAuthData = (): UseAuthDataReturn => {
  const { state, dispatch } = useAuthContext();
  const { isLoggedIn: isLoggedInUser } = useIsLoggedIn();

  const swrKey = isLoggedInUser ? makeUserProfileUrl() : null;
  const shouldRetryOnError = (error: any) => {
    // Do not retry on 401 Unauthorized errors
    if (error?.status === 401 || error?.response?.status === 401) return false;
    return true;
  };

  const {
    data: userData,
    isValidating: isUserDataLoading,
    error: userDataError,
    mutate: refreshUserData,
  } = useSWR(swrKey, getUserProfile, {
    shouldRetryOnError,
  });

  // Keep isAuthenticated in sync with the login cookie
  useEffect(() => {
    dispatch({ type: 'SET_AUTHENTICATED', payload: isLoggedInUser });
  }, [isLoggedInUser, dispatch]);

  // Sync SWR data with auth context
  const handleUserDataError = useCallback(() => {
    if (!userDataError) return false;
    // If a token refresh is in progress, treat this as a transient state and skip error handling.
    if (isTokenRefreshInProgress()) {
      addSentryBreadcrumb('auth.refresh', 'profile fetch skipped - refresh in progress');
      return true;
    }
    const authError = classifyError(userDataError, {
      transactionName: 'useAuthData',
      userDataError,
    });
    logErrorToSentry(userDataError, {
      transactionName: 'useAuthData',
      metadata: { userDataError },
    });
    if (authError.type === 'unauthorized') {
      dispatch({ type: 'SET_AUTHENTICATED', payload: false });
    }
    dispatch({ type: 'SET_ERROR', payload: authError });
    return true;
  }, [userDataError, dispatch]);

  const handleUserDataSuccessOrEmpty = useCallback(() => {
    if (userData) {
      dispatch({ type: 'SET_USER', payload: userData });
      return;
    }
    if (
      !isUserDataLoading &&
      !userData &&
      !userDataError &&
      state.isAuthenticated &&
      !state.profileLoaded
    ) {
      dispatch({ type: 'SET_ERROR', payload: null });
    }
  }, [
    userData,
    isUserDataLoading,
    userDataError,
    state.isAuthenticated,
    state.profileLoaded,
    dispatch,
  ]);

  useEffect(() => {
    if ((isUserDataLoading || isTokenRefreshInProgress()) && !userData) {
      addSentryBreadcrumb('auth.loading', 'profile fetch loading', {
        isUserDataLoading,
        isTokenRefreshInProgress: isTokenRefreshInProgress(),
        userDataLoaded: !!userData,
      });
      dispatch({ type: 'SET_LOADING', payload: true });
      return;
    }
    if (handleUserDataError()) return;
    handleUserDataSuccessOrEmpty();
  }, [userData, isUserDataLoading, handleUserDataError, handleUserDataSuccessOrEmpty, dispatch]);

  return {
    ...state,
    userData,
    userDataError,
    refreshUserData,
  };
};

export default useAuthData;
