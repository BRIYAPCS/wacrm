/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name.
   *  Keep this union in sync with `TEMPLATE_ICONS` in the flows page —
   *  an unmapped name falls back to a generic icon, not a crash. */
  icon:
    | "MessageSquare"
    | "HelpCircle"
    | "UserPlus"
    | "Calendar"
    | "Package"
    | "Star"
    | "Clock"
    | "Calculator"
    | "Mail"
    | "Headphones"
    | "Ticket"
    | "ShoppingCart";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Appointment booking — collect details, confirm, hand off
// ============================================================
const APPOINTMENT_BOOKING: FlowTemplate = {
  slug: "appointment_booking",
  name: "Appointment booking",
  description:
    "Collect a customer's name, the service they want, and their preferred time, then hand off to your team to confirm the slot.",
  icon: "Calendar",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["book", "appointment", "schedule", "booking"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "greet" } },
    {
      node_key: "greet",
      node_type: "send_message",
      config: {
        text: "Happy to get you booked in! 📅 I'll grab a few quick details.",
        next_node_key: "ask_name",
      },
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "First, what's your full name?",
        var_key: "name",
        next_node_key: "ask_service",
      },
    },
    {
      node_key: "ask_service",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! Which service would you like to book?",
        var_key: "service",
        next_node_key: "ask_time",
      },
    },
    {
      node_key: "ask_time",
      node_type: "collect_input",
      config: {
        prompt_text: "What day and time works best for you?",
        var_key: "preferred_time",
        next_node_key: "confirm",
      },
    },
    {
      node_key: "confirm",
      node_type: "send_buttons",
      config: {
        text: "Perfect — shall I pass this to our team to confirm your slot?",
        buttons: [
          { reply_id: "yes", title: "Yes, please", next_node_key: "handoff" },
          { reply_id: "restart", title: "Start over", next_node_key: "greet" },
        ],
      },
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Appointment request — name={{vars.name}}, service={{vars.service}}, preferred time={{vars.preferred_time}}. Please confirm the slot.",
      },
    },
  ],
};

// ============================================================
// 5. Order status — capture an order number, hand off to check
// ============================================================
const ORDER_STATUS: FlowTemplate = {
  slug: "order_status",
  name: "Order status",
  description:
    "Customers asking about an order get prompted for their order number, then handed off to your team to look it up.",
  icon: "Package",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["order", "track", "tracking", "status", "where"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "ask_order" } },
    {
      node_key: "ask_order",
      node_type: "collect_input",
      config: {
        prompt_text: "Sure! What's your order number? 📦",
        var_key: "order_number",
        next_node_key: "ack",
      },
    },
    {
      node_key: "ack",
      node_type: "send_message",
      config: {
        text: "Thanks! Let me pull that up for you — one moment.",
        next_node_key: "handoff",
      },
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Order status request for order {{vars.order_number}} — please look it up and reply.",
      },
    },
  ],
};

// ============================================================
// 6. Feedback survey — branch on satisfaction, salvage unhappy
// ============================================================
const FEEDBACK_SURVEY: FlowTemplate = {
  slug: "feedback_survey",
  name: "Feedback survey",
  description:
    "Ask how the experience was. Happy customers get nudged toward a review; unhappy ones are asked what went wrong and handed off to be made right.",
  icon: "Star",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["feedback", "review", "survey"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "rate" } },
    {
      node_key: "rate",
      node_type: "send_buttons",
      config: {
        text: "How was your experience with us?",
        buttons: [
          { reply_id: "good", title: "Great 🌟", next_node_key: "thanks_good" },
          { reply_id: "ok", title: "It was okay", next_node_key: "thanks_ok" },
          { reply_id: "bad", title: "Not great", next_node_key: "ask_more" },
        ],
      },
    },
    {
      node_key: "thanks_good",
      node_type: "send_message",
      config: {
        text: "So glad to hear it! 🙌 A quick review would mean the world: https://example.com/review",
        next_node_key: "end",
      },
    },
    {
      node_key: "thanks_ok",
      node_type: "send_message",
      config: {
        text: "Thanks for the honest feedback — we're always working to improve!",
        next_node_key: "end",
      },
    },
    {
      node_key: "ask_more",
      node_type: "collect_input",
      config: {
        prompt_text: "We're sorry to hear that. What went wrong? We'd like to make it right.",
        var_key: "feedback",
        next_node_key: "handoff",
      },
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Unhappy-customer feedback to follow up on: {{vars.feedback}}",
      },
    },
    { node_key: "end", node_type: "end", config: {} },
  ],
};

// ============================================================
// 7. After-hours auto-responder — greet, offer to take a message
// ============================================================
const AFTER_HOURS: FlowTemplate = {
  slug: "after_hours",
  name: "After-hours responder",
  description:
    "Catch first messages when you're closed: share your hours and offer to take a message that lands with your team for the morning.",
  icon: "Clock",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "notice" } },
    {
      node_key: "notice",
      node_type: "send_message",
      config: {
        text: "Thanks for reaching out! 🌙 Our team is offline right now (hours: Mon–Fri, 9am–6pm). We'll get back to you as soon as we're back.",
        next_node_key: "offer",
      },
    },
    {
      node_key: "offer",
      node_type: "send_buttons",
      config: {
        text: "Would you like to leave a message in the meantime?",
        buttons: [
          { reply_id: "yes", title: "Leave a message", next_node_key: "ask_msg" },
          { reply_id: "no", title: "No thanks", next_node_key: "bye" },
        ],
      },
    },
    {
      node_key: "ask_msg",
      node_type: "collect_input",
      config: {
        prompt_text: "Go ahead — what can we help you with? We'll reply first thing.",
        var_key: "message",
        next_node_key: "handoff",
      },
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "After-hours message to follow up on: {{vars.message}}",
      },
    },
    {
      node_key: "bye",
      node_type: "send_message",
      config: {
        text: "No problem — we'll be here when you're back. 👋",
        next_node_key: "end",
      },
    },
    { node_key: "end", node_type: "end", config: {} },
  ],
};

// ============================================================
// 8. Quote request — capture name + email (validated) + details
// ============================================================
const QUOTE_REQUEST: FlowTemplate = {
  slug: "quote_request",
  name: "Quote request",
  description:
    "Qualify pricing enquiries: collect a name, a validated email, and what they need, then hand off to sales to send a quote.",
  icon: "Calculator",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["quote", "pricing", "estimate", "cost", "how much"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "intro" } },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Happy to put a quote together for you! 📝 Just a few quick questions.",
        next_node_key: "ask_name",
      },
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      },
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's the best email to send your quote to?",
        var_key: "email",
        // Showcases the collect_input email validator — a reply that
        // isn't email-shaped gets reprompted instead of advancing.
        validation: "email",
        next_node_key: "ask_details",
      },
    },
    {
      node_key: "ask_details",
      node_type: "collect_input",
      config: {
        prompt_text: "Briefly, what would you like a quote for?",
        var_key: "details",
        next_node_key: "handoff",
      },
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Quote request — {{vars.name}} ({{vars.email}}): {{vars.details}}",
      },
    },
  ],
};

// ============================================================
// 9. Newsletter opt-in — validated email, hand off to add to list
// ============================================================
const NEWSLETTER_OPTIN: FlowTemplate = {
  slug: "newsletter_optin",
  name: "Newsletter opt-in",
  description:
    "Turn a 'subscribe' keyword into a captured, validated email address ready to add to your mailing list.",
  icon: "Mail",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["subscribe", "newsletter", "updates", "join"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "ask_email" } },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Great! What email should we add to our newsletter? ✉️",
        var_key: "email",
        validation: "email",
        next_node_key: "confirm",
      },
    },
    {
      node_key: "confirm",
      node_type: "send_message",
      config: {
        text: "You're on the list — welcome aboard! 🎉 Reply STOP anytime to unsubscribe.",
        next_node_key: "handoff",
      },
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "Newsletter opt-in — add {{vars.email}} to the mailing list.",
      },
    },
  ],
};

// ============================================================
// 10. Support triage — 3-way button routing to the right team
// ============================================================
const SUPPORT_TRIAGE: FlowTemplate = {
  slug: "support_triage",
  name: "Support triage",
  description:
    "Route support requests to the right team in one tap — billing, technical, or general — each handed off with context.",
  icon: "Headphones",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["support", "help", "issue", "problem"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
    {
      node_key: "menu",
      node_type: "send_buttons",
      config: {
        text: "Happy to help! What do you need a hand with?",
        buttons: [
          { reply_id: "billing", title: "Billing", next_node_key: "billing_ho" },
          { reply_id: "tech", title: "Technical", next_node_key: "tech_ho" },
          { reply_id: "other", title: "Something else", next_node_key: "other_ho" },
        ],
      },
    },
    {
      node_key: "billing_ho",
      node_type: "handoff",
      config: { note: "Billing support request — route to the billing/finance team." },
    },
    {
      node_key: "tech_ho",
      node_type: "handoff",
      config: { note: "Technical support request — route to the tech team." },
    },
    {
      node_key: "other_ho",
      node_type: "handoff",
      config: { note: "General support request." },
    },
  ],
};

// ============================================================
// 11. Event RSVP — confirm / decline / maybe, each handed off
// ============================================================
const EVENT_RSVP: FlowTemplate = {
  slug: "event_rsvp",
  name: "Event RSVP",
  description:
    "Collect RSVPs in one tap — confirm, decline, or maybe — and hand each off so you can update your guest list.",
  icon: "Ticket",
  trigger_type: "keyword",
  trigger_config: { keywords: ["rsvp", "event", "invite"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "ask" } },
    {
      node_key: "ask",
      node_type: "send_buttons",
      config: {
        text: "Thanks for your interest! Will you be joining us? 🎟️",
        buttons: [
          { reply_id: "yes", title: "I'll be there", next_node_key: "yes_ho" },
          { reply_id: "no", title: "Can't make it", next_node_key: "no_ho" },
          { reply_id: "maybe", title: "Maybe", next_node_key: "maybe_ho" },
        ],
      },
    },
    {
      node_key: "yes_ho",
      node_type: "handoff",
      config: { note: "RSVP: attending — add to the confirmed guest list." },
    },
    {
      node_key: "no_ho",
      node_type: "handoff",
      config: { note: "RSVP: not attending — mark as declined." },
    },
    {
      node_key: "maybe_ho",
      node_type: "handoff",
      config: { note: "RSVP: maybe — follow up closer to the date." },
    },
  ],
};

// ============================================================
// 12. Abandoned-cart nudge — a MANUAL flow an agent runs from the
//     inbox (see the "Run a flow" action) to re-engage a contact.
// ============================================================
const ABANDONED_CART: FlowTemplate = {
  slug: "abandoned_cart",
  name: "Abandoned-cart nudge",
  description:
    "A manual flow an agent launches from a conversation (Run a flow) to nudge a customer who didn't finish checking out.",
  icon: "ShoppingCart",
  trigger_type: "manual",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "nudge" } },
    {
      node_key: "nudge",
      node_type: "send_message",
      config: {
        text: "Hi! 👋 We noticed you didn't finish your order — your items are still saved. Can we help you complete it?",
        next_node_key: "offer",
      },
    },
    {
      node_key: "offer",
      node_type: "send_buttons",
      config: {
        text: "Would you like a hand checking out?",
        buttons: [
          { reply_id: "yes", title: "Yes, help me", next_node_key: "help_ho" },
          { reply_id: "no", title: "Maybe later", next_node_key: "bye" },
        ],
      },
    },
    {
      node_key: "help_ho",
      node_type: "handoff",
      config: { note: "Customer wants help completing an abandoned order — assist with checkout." },
    },
    {
      node_key: "bye",
      node_type: "send_message",
      config: {
        text: "No worries — your cart will be here whenever you're ready. 🛒",
        next_node_key: "end",
      },
    },
    { node_key: "end", node_type: "end", config: {} },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
  appointment_booking: APPOINTMENT_BOOKING,
  order_status: ORDER_STATUS,
  feedback_survey: FEEDBACK_SURVEY,
  after_hours: AFTER_HOURS,
  quote_request: QUOTE_REQUEST,
  newsletter_optin: NEWSLETTER_OPTIN,
  support_triage: SUPPORT_TRIAGE,
  event_rsvp: EVENT_RSVP,
  abandoned_cart: ABANDONED_CART,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
