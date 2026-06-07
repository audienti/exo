// @ts-check

const LINKEDIN_MESSAGING_INBOX_SOURCE_FILES = [
  "omalab/v10/app/services/social_api/linkedin/messaging/scan_inbox.rb",
  "omalab/v10/app/services/social_api/linkedin/messaging/orchestrator.rb",
  "omalab/v10/app/services/social_api/linkedin/messaging/threads_extractor.rb",
  "omalab/v10/app/services/social_api/linkedin/messaging/messages_extractor.rb"
];

const LINKEDIN_SENT_INVITATIONS_SOURCE_FILES = [
  "omalab/v10/app/services/social_api/linkedin/invitations/capture_invitation_manager_bodies.rb",
  "omalab/v10/app/services/social_api/linkedin/invitations/ui_helpers.rb",
  "omalab/v10/app/services/social_api/linkedin/invitations/orchestrator.rb",
  "omalab/v10/app/services/social_api/linkedin/invitations/sent_extractor.rb",
  "omalab/v10/docs/superpowers/specs/2026-03-27-sent-invitations-load-more-design.md"
];

const LINKEDIN_PROFILE_VIEWS_SOURCE_FILES = [
  "omalab/v10/app/services/social_api/linkedin/profile_views/orchestrator.rb",
  "omalab/v10/app/services/social_api/linkedin/profile_views/capture_page_data.rb",
  "omalab/v10/app/services/social_api/linkedin/profile_views/extractor.rb",
  "omalab/v10/app/services/social_api/linkedin/profile_views/dom_extractor.rb",
  "omalab/v10/docs/superpowers/specs/2026-05-01-linkedin-profile-view-reply-sync-design.md"
];

const LINKEDIN_FOLLOW_LIST_SOURCE_FILES = [
  "omalab/v10/app/services/social_api/linkedin/follow_lists/orchestrator.rb",
  "omalab/v10/app/services/social_api/linkedin/follow_lists/extractor.rb",
  "omalab/v10/docs/superpowers/specs/2026-04-10-linkedin-followings-sync-design.md"
];

const LINKEDIN_PROFILE_PAGE_SOURCE_FILES = [
  "omalab/v10/app/services/social_api/linkedin/view_profile/orchestrator.rb",
  "omalab/v10/app/services/social_api/linkedin/view_profile/extractor.rb",
  "omalab/v10/app/services/social_api/linkedin/profile_activity/orchestrator.rb",
  "omalab/v10/app/services/social_api/linkedin/profile_activity/extractor.rb",
  "omalab/v10/test/services/social_api/linkedin/view_profile/extractor_test.rb",
  "omalab/v10/test/services/social_api/linkedin/profile_activity/extractor_test.rb"
];

const LINKEDIN_MESSAGING_ENTRY_HINTS = {
  startUrls: [
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/messaging/"
  ],
  navLinkSelectors: [
    'a[href^="https://www.linkedin.com/messaging"]',
    'a[href*="/messaging"]',
    'a[aria-label*="Messaging"]',
    'a[title*="Messaging"]'
  ],
  directThreadUrlPattern: "https://www.linkedin.com/messaging/thread/<thread-id>/"
};

const LINKEDIN_MESSAGING_READY_HINTS = {
  conversationRowsSelector: "li.msg-conversation-listitem:not(.msg-conversation-card--occluded)",
  conversationLinkSelector: ".msg-conversation-listitem__link.msg-conversations-container__convo-item-link",
  conversationTitleSelectors: [
    ".msg-conversation-listitem__participant-names .truncate",
    ".msg-conversation-card__participant-names .truncate",
    "h3.msg-conversation-card__participant-names",
    "h3.msg-conversation-listitem__participant-names"
  ],
  conversationListScrollSelectors: [
    ".msg-conversations-container__conversations-list",
    ".msg-conversations-container",
    ".msg-conversations-container__convo-list",
    ".scaffold-layout__list"
  ],
  messageTextboxSelectors: [
    'div[role="textbox"][contenteditable="true"]',
    'div.msg-form__contenteditable[contenteditable="true"]',
    "div.msg-form__contenteditable",
    "textarea"
  ],
  messageHistoryScrollSelectors: [
    ".msg-s-message-list-container",
    ".msg-s-message-list",
    ".msg-thread__content-container",
    ".msg-thread",
    ".scaffold-layout__main"
  ]
};

const LINKEDIN_MESSAGING_FALLBACK_HINTS = {
  overlayExpandButtonPhrases: [
    "open the list of conversations",
    "messaging overlay"
  ],
  openThreadStrategies: [
    "open_thread_via_url",
    "open_thread_via_list_click",
    "reselect_thread_then_reopen",
    "focus_thread_composer",
    "stimulate_message_history"
  ],
  conversationPaginationTriggers: [
    "load more conversations",
    "scroll conversation list"
  ],
  messagePaginationTriggers: [
    "load older messages",
    "show more messages",
    "load more messages",
    "scroll message history upward"
  ]
};

const LINKEDIN_MESSAGING_FAILURE_HINTS = {
  authwallStates: ["login", "authwall"],
  failClosedReasons: [
    "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
    "The LinkedIn messaging home never rendered a usable conversation list after navigation and overlay expansion.",
    "Only toast or shell chrome is visible and no usable LinkedIn conversation list rendered."
  ],
  warningCases: [
    "Only the visible thread slice was itemized.",
    "A thread opened but its full message history could not be paginated.",
    "The inbox rendered enough shell to produce smoke cues, but not enough stable DOM to prove thread truth."
  ]
};

const LINKEDIN_MESSAGING_CUE_HINTS = {
  smokeSignals: [
    "affiliated mailboxes detected",
    "page mailboxes detected",
    "secondary inbox preview detected"
  ],
  note: "Treat mailbox counts or secondary previews as smoke only. They create sync pressure, not durable message truth."
};

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinQuickSurfaceHints(input = {}) {
  return {
    sentInvitations: buildLinkedinSentInvitationsSurfaceHint(input),
    receivedInvitations: buildLinkedinReceivedInvitationsSurfaceHint(input),
    messagingInbox: buildLinkedinMessagingInboxSurfaceHint(input),
    profileViews: buildLinkedinProfileViewsSurfaceHint(input),
    followersList: buildLinkedinFollowersSurfaceHint(input),
    followingList: buildLinkedinFollowingSurfaceHint(input)
  };
}

/**
 * @param {{
 *   profileUrl?: string | null,
 *   recentPostLimit?: number | null
 * }} [input]
 */
export function buildLinkedinProfilePageSurfaceHint(input = {}) {
  const profileUrl = typeof input.profileUrl === "string" && input.profileUrl.trim()
    ? input.profileUrl.trim()
    : null;
  const recentPostLimit = normalizePositiveInteger(input.recentPostLimit, 3);
  const canonicalProfileUrl = profileUrl
    ? profileUrl.replace(/\/+$/, "/")
    : null;
  const baseProfileUrl = canonicalProfileUrl
    ? canonicalProfileUrl.replace(/\/+$/, "")
    : null;

  return {
    surface: "linkedin-profile-page",
    goal: "Inspect one live LinkedIn profile page, capture stable identity and profile context, and itemize the strongest recent posts directly from the page without inventing a separate scraper state model.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_PROFILE_PAGE_SOURCE_FILES,
      note: "Distilled from the legacy LinkedIn view-profile and profile-activity extraction paths. Exo owns this contract now."
    },
    entryHints: {
      startUrls: canonicalProfileUrl
        ? [
            canonicalProfileUrl,
            `${baseProfileUrl}/details/experience/`,
            `${baseProfileUrl}/recent-activity/all/`
          ]
        : [
            "https://www.linkedin.com/feed/"
          ],
      canonicalProfileUrl,
      detailsUrls: canonicalProfileUrl
        ? [
            `${baseProfileUrl}/details/experience/`,
            `${baseProfileUrl}/details/education/`,
            `${baseProfileUrl}/details/skills/`
          ]
        : [],
      activityUrls: canonicalProfileUrl
        ? [
            `${baseProfileUrl}/recent-activity/all/`,
            `${baseProfileUrl}/recent-activity/shares/`
          ]
        : []
    },
    readyHints: {
      profileUrlPattern: "/in/",
      topCardSelectors: [
        "main[role='main']",
        ".scaffold-layout__main",
        ".pv-top-card",
        "[data-view-name='profile-component-entity']"
      ],
      nameSelectors: [
        "h1",
        ".pv-text-details__left-panel h1",
        "[data-generated-suggestion-target] h1"
      ],
      headlineSelectors: [
        ".text-body-medium.break-words",
        ".pv-text-details__left-panel .text-body-medium",
        "[data-field='headline']"
      ],
      aboutSelectors: [
        "#about",
        "[data-view-name='profile-component-about']",
        ".pv-about-section"
      ],
      recentActivitySelectors: [
        "[data-view-name='profile-component-activity']",
        "[data-view-name='profile-component-shared-activity']",
        ".scaffold-finite-scroll__content"
      ]
    },
    fallbackHints: {
      entryStrategies: [
        "open_profile_url_directly",
        "revisit_profile_after_details_pages",
        "open_recent_activity_route_directly"
      ],
      expansionActions: [
        "expand_about_section",
        "expand_recent_activity_module",
        "click_show_all_posts"
      ],
      paginationRecovery: [
        "scroll_recent_activity_list",
        "open_recent_activity_all_route"
      ]
    },
    failureHints: {
      failClosedReasons: [
        "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
        "The LinkedIn profile page did not render a stable top card for the intended profile.",
        "The profile page rendered shell chrome but no trustworthy identity fields."
      ],
      warningCases: [
        "Only stable identity fields were captured and no recent public activity rendered.",
        "Only the visible top slice of recent activity was itemized.",
        "The page exposed profile identity, but recent activity required deeper navigation than this bounded pass allowed."
      ]
    },
    extractionHints: {
      recentPostLimit,
      identityFields: [
        "public_identifier",
        "member_urn",
        "member_id",
        "display_name",
        "headline",
        "location",
        "about",
        "profile_picture_url",
        "follower_count",
        "connection_count",
        "current_company_name",
        "current_role_title"
      ],
      recentPostFields: [
        "activity_type",
        "post_url",
        "posted_at",
        "summary",
        "snippet"
      ],
      networkNodeKeys: [
        "profile",
        "feedDashProfileUpdatesByMemberShareFeed",
        "feedDashProfileUpdatesByMemberComments",
        "feedDashProfileUpdatesByMemberReactions"
      ],
      recentPostPriorityRule: "Prefer the freshest explicit own-post or comment that produces a legitimate writing hook. Keep at most the strongest visible recentPostLimit items.",
      payloadRule: "Return one profile payload with stable identity fields plus recentPosts; do not split profile identity and recent activity into separate payloads."
    }
  };
}

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinMessagingInboxSurfaceHint(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    surface: "linkedin-messaging-inbox",
    goal: "Inspect the live LinkedIn messaging surface, capture only thread updates that materially change operator action, and distinguish a bounded unread-thread pass from full reconciliation.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_MESSAGING_INBOX_SOURCE_FILES,
      note: "Distilled from the legacy LinkedIn messaging retrieval path. Exo owns this contract now."
    },
    entryHints: LINKEDIN_MESSAGING_ENTRY_HINTS,
    readyHints: LINKEDIN_MESSAGING_READY_HINTS,
    fallbackHints: LINKEDIN_MESSAGING_FALLBACK_HINTS,
    failureHints: LINKEDIN_MESSAGING_FAILURE_HINTS,
    cueHints: LINKEDIN_MESSAGING_CUE_HINTS,
    extractionHints: {
      perSurfaceItemLimit: limit,
      threadNodeKeys: [
        "messengerConversationsByCategoryQuery",
        "messengerConversationsBySyncToken",
        "messengerConversationsBySearchCriteria"
      ],
      messageNodeKeys: [
        "messengerMessagesBySyncToken",
        "messengerMessagesByAnchorTimestamp",
        "messengerMessagesByConversation"
      ],
      threadFields: [
        "conversation_urn",
        "thread_urn",
        "conversation_url",
        "read",
        "group_chat",
        "preview_text",
        "direction_marker",
        "last_activity_at",
        "participants"
      ],
      participantFields: [
        "host_identity_urn",
        "identifier",
        "username",
        "url",
        "display_name",
        "headline",
        "distance",
        "self"
      ],
      messageFields: [
        "message_urn",
        "conversation_urn",
        "thread_urn",
        "sender_urn",
        "delivered_at_ms",
        "body",
        "subject"
      ],
      partialCaptureRule: "Return warning when the agent only itemized a bounded unread-thread slice or a bounded message-history slice."
    }
  };
}

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinSentInvitationsSurfaceHint(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    surface: "linkedin-sent-invitations",
    goal: "Inspect the live LinkedIn sent-invitations surface, distinguish bounded quick-pass triage from full reconciliation, and never overclaim pending-invite completeness.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_SENT_INVITATIONS_SOURCE_FILES,
      note: "Distilled from the legacy invitation-manager capture loop and sent-extractor pagination behavior. Exo owns this contract now."
    },
    entryHints: {
      startUrls: [
        "https://www.linkedin.com/feed/",
        "https://www.linkedin.com/mynetwork/",
        "https://www.linkedin.com/mynetwork/invitation-manager/sent/"
      ],
      invitationManagerRootUrls: [
        "https://www.linkedin.com/mynetwork/invitation-manager/",
        "https://www.linkedin.com/flagship-web/mynetwork/invitation-manager/"
      ],
      sentManagerUrls: [
        "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        "https://www.linkedin.com/flagship-web/mynetwork/invitation-manager/sent"
      ],
      sentTabTexts: ["sent"],
      directFallbackAllowed: true
    },
    readyHints: {
      managerUrlPatterns: [
        "/mynetwork/invitation-manager/sent",
        "/flagship-web/mynetwork/invitation-manager/sent"
      ],
      finiteScrollSelectors: [
        ".scaffold-finite-scroll__content",
        ".scaffold-finite-scroll",
        "[data-finite-scroll]",
        "[class*='invitation-manager']",
        "main[role='main']",
        "main"
      ],
      entryControlSignals: [
        "show all invitations",
        "invitation manager"
      ]
    },
    fallbackHints: {
      entryStrategies: [
        "navigate_via_feed_to_mynetwork",
        "click_invitation_manager_entry",
        "click_sent_tab",
        "direct_sent_manager_url"
      ],
      paginationRecovery: [
        "scroll_invitation_manager_list",
        "click_load_more"
      ]
    },
    paginationHints: {
      loadMoreTriggerText: ["load more"],
      quickMode: {
        strategy: "top_slice_with_gap_accounting",
        stopCondition: "first material quick-pass slice itemized, then preserve any remaining total as an explicit itemization gap"
      },
      reconcileMode: {
        strategy: "paginate_until_terminal_zero_row",
        triggers: [
          "visible_total_exceeds_itemized_rows",
          "onboarding_reconciliation_requested",
          "operator_requests_full_reconcile"
        ],
        advanceOrder: [
          "scroll_invitation_manager_list",
          "click_load_more"
        ],
        maxPassesHint: 2,
        completeSignal: "terminal_zero_row_pagination_seen",
        incompleteSignal: "pending_invitation_itemization_gap"
      }
    },
    failureHints: {
      failClosedReasons: [
        "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
        "The invitation manager sent surface never rendered a usable pending-invite list."
      ],
      incompleteReasons: [
        "LinkedIn exposed a total pending count larger than the itemized sent rows.",
        "The sent invitations surface required further pagination before Exo could treat the backlog as reconciled."
      ]
    },
    extractionHints: {
      perSurfaceItemLimit: limit,
      requiredKeys: [
        "invitation_manager_sent",
        "invitations_pagination"
      ],
      identityFields: [
        "profile_platform_id",
        "invitee_member_id",
        "username",
        "profile_url",
        "inviter_action_type",
        "invitation_id"
      ],
      terminalZeroRowRule: "Treat a final pagination body with zero extracted rows as the completion signal for full sent-surface reconciliation.",
      eventAtRule: "Each sent-invitations row carries a visible relative-time string near the actor (e.g. 'Sent today', 'Sent yesterday', 'Sent 1 day ago', 'Sent 3 weeks ago', 'Sent 1 month ago', 'Sent 2 months ago', 'Sent 1 year ago'). Convert that string to an absolute ISO 8601 timestamp by subtracting the stated interval from the moment you observe the row (today=0d, yesterday=1d, N hours=N*3600s, N days=N*86400s, N weeks=N*7d, N months=N*30d, N years=N*365d), and emit it as the row's eventAt (the moment the invitation was sent). When LinkedIn shows no relative-time string for a row, set eventAt to null — do not fall back to the observedAt timestamp."
    }
  };
}

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinReceivedInvitationsSurfaceHint(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    surface: "linkedin-received-invitations",
    goal: "Inspect the live LinkedIn received-invitations surface, itemize the inbound requests currently waiting for operator action, and fail closed if the list never renders.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_SENT_INVITATIONS_SOURCE_FILES,
      note: "There was no separate legacy received-invitations contract. This mirrors the invitation-manager sent capture path against the received queue."
    },
    entryHints: {
      startUrls: [
        "https://www.linkedin.com/feed/",
        "https://www.linkedin.com/mynetwork/",
        "https://www.linkedin.com/mynetwork/invitation-manager/received/"
      ],
      invitationManagerRootUrls: [
        "https://www.linkedin.com/mynetwork/invitation-manager/",
        "https://www.linkedin.com/flagship-web/mynetwork/invitation-manager/"
      ],
      receivedManagerUrls: [
        "https://www.linkedin.com/mynetwork/invitation-manager/received/",
        "https://www.linkedin.com/flagship-web/mynetwork/invitation-manager/received"
      ],
      receivedTabTexts: ["received"],
      directFallbackAllowed: true
    },
    readyHints: {
      managerUrlPatterns: [
        "/mynetwork/invitation-manager/received",
        "/flagship-web/mynetwork/invitation-manager/received"
      ],
      finiteScrollSelectors: [
        ".scaffold-finite-scroll__content",
        ".scaffold-finite-scroll",
        "[data-finite-scroll]",
        "[class*='invitation-manager']",
        "main[role='main']",
        "main"
      ],
      rowActionSignals: [
        "accept",
        "ignore"
      ]
    },
    fallbackHints: {
      entryStrategies: [
        "navigate_via_feed_to_mynetwork",
        "click_invitation_manager_entry",
        "click_received_tab",
        "direct_received_manager_url"
      ],
      paginationRecovery: [
        "scroll_invitation_manager_list",
        "click_load_more"
      ]
    },
    paginationHints: {
      loadMoreTriggerText: ["load more"],
      quickMode: {
        strategy: "top_slice_with_gap_accounting",
        stopCondition: "itemize the visible received-invite slice, then preserve any larger visible total as an explicit gap"
      },
      reconcileMode: {
        strategy: "paginate_until_terminal_zero_row",
        triggers: [
          "visible_total_exceeds_itemized_rows",
          "operator_requests_full_reconcile"
        ],
        advanceOrder: [
          "scroll_invitation_manager_list",
          "click_load_more"
        ],
        maxPassesHint: 2,
        completeSignal: "terminal_zero_row_pagination_seen",
        incompleteSignal: "received_invitation_itemization_gap"
      }
    },
    failureHints: {
      failClosedReasons: [
        "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
        "The invitation manager received surface never rendered a usable inbound-invite list."
      ],
      warningCases: [
        "Only the bounded quick-pass slice of received invitations was itemized.",
        "The received invitations surface showed a larger visible total than the current bounded itemization."
      ]
    },
    extractionHints: {
      perSurfaceItemLimit: limit,
      identityFields: [
        "profile_platform_id",
        "invitee_member_id",
        "username",
        "profile_url",
        "invitation_id"
      ]
    }
  };
}

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinFollowersSurfaceHint(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    surface: "linkedin-followers-list",
    goal: "Inspect the live LinkedIn followers surface, capture who currently follows us, and distinguish a bounded quick-pass slice from a full followers reconciliation.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_FOLLOW_LIST_SOURCE_FILES,
      note: "There was no dedicated legacy followers extractor. This contract mirrors the follow-lists architecture and applies it to LinkedIn's followers surface."
    },
    entryHints: {
      startUrls: [
        "https://www.linkedin.com/feed/",
        "https://www.linkedin.com/mynetwork/",
        "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/"
      ],
      directFollowersUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
      directFallbackAllowed: true
    },
    readyHints: {
      pageUrlPatterns: [
        "/mynetwork/network-manager/people-follow/followers"
      ],
      finiteScrollSelectors: [
        ".scaffold-finite-scroll__content",
        ".scaffold-finite-scroll",
        "[data-finite-scroll]",
        "[class*='mn-follow']",
        "[class*='network-manager']",
        "main[role='main']",
        "main"
      ],
      rowSelectors: [
        "li",
        "article",
        "[data-view-name='people-follow-list'] li",
        "[class*='follow-list'] li"
      ],
      rowIdentitySignals: [
        "profile anchor",
        "profile image",
        "follow-back row"
      ]
    },
    fallbackHints: {
      entryStrategies: [
        "navigate_via_feed_to_mynetwork",
        "open_followers_manager_url_directly",
        "switch_to_followers_tab_if_following_page_loaded"
      ],
      paginationRecovery: [
        "scroll_followers_list",
        "click_load_more"
      ]
    },
    paginationHints: {
      loadMoreTriggerText: ["load more", "show more"],
      quickMode: {
        strategy: "top_slice_with_gap_accounting",
        stopCondition: "itemize the strongest visible follower slice, then preserve the remainder as an explicit itemization gap when the visible total is larger"
      },
      reconcileMode: {
        strategy: "paginate_until_surface_stalls_or_cap",
        triggers: [
          "visible_total_exceeds_itemized_rows",
          "operator_requests_full_reconcile",
          "follower_change_signal_needs_truth"
        ],
        advanceOrder: [
          "scroll_followers_list",
          "click_load_more"
        ],
        stopCondition: "stop when no new follower rows appear across the allowed stalled passes"
      }
    },
    failureHints: {
      failClosedReasons: [
        "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
        "The followers surface never rendered a usable list of current followers."
      ],
      warningCases: [
        "Only the bounded quick-pass slice of followers was itemized.",
        "The followers surface showed a larger visible total than the current bounded itemization."
      ]
    },
    extractionHints: {
      perSurfaceItemLimit: limit,
      itemKinds: [
        "follower_confirmed",
        "follower_added"
      ],
      identityFields: [
        "profile_platform_id",
        "member_id",
        "username",
        "profile_url",
        "display_name",
        "headline",
        "company_name",
        "avatar_url"
      ],
      captureRule: "Emit follower_confirmed for ordinary current-list rows. Use follower_added only when the live surface itself clearly marks the follow as newly happened during this capture window.",
      signalRule: "Followers are real attention signals. They do not prove connection state, but they should be written back as durable inbound observations."
    }
  };
}

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinFollowingSurfaceHint(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    surface: "linkedin-following-list",
    goal: "Inspect the live LinkedIn following surface, capture who we are currently following, and distinguish a bounded quick-pass slice from a full following reconciliation.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_FOLLOW_LIST_SOURCE_FILES,
      note: "Distilled from the legacy follow-lists contract for the current following state."
    },
    entryHints: {
      startUrls: [
        "https://www.linkedin.com/feed/",
        "https://www.linkedin.com/mynetwork/",
        "https://www.linkedin.com/mynetwork/network-manager/people-follow/following/"
      ],
      directFollowingUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/following/",
      directFallbackAllowed: true
    },
    readyHints: {
      pageUrlPatterns: [
        "/mynetwork/network-manager/people-follow/following"
      ],
      finiteScrollSelectors: [
        ".scaffold-finite-scroll__content",
        ".scaffold-finite-scroll",
        "[data-finite-scroll]",
        "[class*='mn-follow']",
        "[class*='network-manager']",
        "main[role='main']",
        "main"
      ],
      rowSelectors: [
        "li",
        "article",
        "[data-view-name='people-follow-list'] li",
        "[class*='follow-list'] li"
      ]
    },
    fallbackHints: {
      entryStrategies: [
        "navigate_via_feed_to_mynetwork",
        "open_following_manager_url_directly",
        "switch_to_following_tab_if_followers_page_loaded"
      ],
      paginationRecovery: [
        "scroll_following_list",
        "click_load_more"
      ]
    },
    paginationHints: {
      loadMoreTriggerText: ["load more", "show more"],
      quickMode: {
        strategy: "top_slice_with_gap_accounting",
        stopCondition: "itemize the strongest visible following slice, then preserve the remainder as an explicit itemization gap when the visible total is larger"
      },
      reconcileMode: {
        strategy: "paginate_until_surface_stalls_or_cap",
        triggers: [
          "visible_total_exceeds_itemized_rows",
          "operator_requests_full_reconcile",
          "follow_state_truth_needs_reconcile"
        ],
        advanceOrder: [
          "scroll_following_list",
          "click_load_more"
        ],
        stopCondition: "stop when no new following rows appear across the allowed stalled passes"
      }
    },
    failureHints: {
      failClosedReasons: [
        "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
        "The following surface never rendered a usable list of current follows."
      ],
      warningCases: [
        "Only the bounded quick-pass slice of following rows was itemized.",
        "The following surface showed a larger visible total than the current bounded itemization."
      ]
    },
    extractionHints: {
      perSurfaceItemLimit: limit,
      itemKinds: [
        "follow_state_confirmed",
        "follow_state_changed"
      ],
      identityFields: [
        "profile_platform_id",
        "member_id",
        "username",
        "profile_url",
        "display_name",
        "headline",
        "company_name",
        "avatar_url"
      ]
    }
  };
}

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinProfileViewsSurfaceHint(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    surface: "linkedin-profile-views",
    goal: "Inspect the live LinkedIn profile-views surface, capture the highest-signal visible viewers quickly, and support deeper reconciliation when the operator needs fuller account-state truth.",
    source: {
      kind: "legacy_bootstrap",
      app: "v10",
      files: LINKEDIN_PROFILE_VIEWS_SOURCE_FILES,
      note: "Distilled from the legacy profile-views capture and extraction path. Exo owns this contract now."
    },
    entryHints: {
      startUrls: [
        "https://www.linkedin.com/feed/",
        "https://www.linkedin.com/analytics/profile-views/"
      ],
      directProfileViewsUrl: "https://www.linkedin.com/analytics/profile-views/",
      blankFirstRetryAllowed: true
    },
    readyHints: {
      pageUrlPatterns: ["/analytics/profile-views"],
      finiteScrollSelectors: [
        ".scaffold-finite-scroll__content",
        ".scaffold-finite-scroll",
        "[data-finite-scroll]",
        "[class*='profile-views']",
        "[class*='analytics']",
        "main[role='main']",
        "main"
      ],
      domFallbackRootSelectors: [
        "main[role='main']",
        "main",
        "body"
      ]
    },
    paginationHints: {
      loadMoreTriggerText: ["load more"],
      quickMode: {
        strategy: "top_slice_with_gap_accounting",
        stopCondition: "itemize the strongest visible viewer slice, then preserve the remainder as a partial-capture gap when the surface total is larger"
      },
      reconcileMode: {
        strategy: "paginate_until_surface_stalls_or_cap",
        triggers: [
          "visible_total_exceeds_itemized_rows",
          "onboarding_reconciliation_requested",
          "operator_requests_full_reconcile"
        ],
        advanceOrder: [
          "scroll_profile_views_list",
          "click_load_more"
        ],
        stopCondition: "stop when both scroll and load-more fail to add payloads or bodies across the allowed stalled passes"
      }
    },
    failureHints: {
      failClosedReasons: [
        "The active signed-in LinkedIn identity could not be verified against the intended Exo account.",
        "The profile-views surface never rendered enough stable content to extract any governed viewer rows."
      ],
      warningCases: [
        "Only the bounded quick-pass slice of profile viewers was itemized.",
        "Anonymous or company-only viewers remain low-confidence attention signals even when itemized."
      ]
    },
    extractionHints: {
      perSurfaceItemLimit: limit,
      sourceFamilies: [
        "voyager_wvmp",
        "sdui_wvmp",
        "dom_wvmp"
      ],
      viewerFields: [
        "viewer_kind",
        "viewer_identity_key",
        "profile_platform_id",
        "username",
        "profile_url",
        "display_name",
        "headline",
        "connection_degree",
        "mutual_connections_text",
        "relative_viewed_text",
        "company_name"
      ],
      lowConfidenceViewerKinds: [
        "company",
        "anonymous"
      ],
      eventAtRule: "Each viewer row shows a relative-viewed string (relative_viewed_text, e.g. 'Viewed today', 'Viewed 2 days ago', 'Viewed last week', 'Viewed 3 weeks ago'). Convert it to an absolute ISO 8601 timestamp by subtracting the stated interval from the moment you observe the row (today=0d, yesterday/last day=1d, N hours=N*3600s, N days=N*86400s, last week=7d, N weeks=N*7d, last month=30d, N months=N*30d, N years=N*365d), and emit it as the row's eventAt (the moment the view happened). When no relative-viewed string is shown, set eventAt to null — do not fall back to the observedAt timestamp.",
      note: "Treat identifiable person viewers as stronger truth than anonymous/company-only rows. Company-only rows can remain attention signals rather than full cadence truth."
    }
  };
}

/**
 * @param {number | null | undefined} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.trunc(parsed);
}
