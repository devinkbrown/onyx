module View.About exposing (accessibilityStatement, accessibilityTopics, route, view)

{-| Community story page, mirroring `src/routes/About.tsx`: hero with
the product-sketch scene, topic anchors, the rooms/people/join/hosting
sections, and the accessibility section whose disclosure carries the
static conformance statement (`AccessibilityStatement`).

Fully static copy — no model state, no messages.
-}

import App exposing (Model, Msg)
import Html exposing (Html, a, article, aside, code, details, div, figcaption, figure, h1, h2, h3, h4, header, img, li, nav, p, section, span, strong, summary, text, ul)
import Html.Attributes exposing (alt, attribute, class, height, href, id, src, width)
import View.PublicFrame exposing (frame)


{-| One accessibility topic. -}
type alias AccessibilityTopic =
    { id : String
    , heading : String
    , summary : String
    , points : List String
    }


{-| Conformance topics, mirroring `ACCESSIBILITY_TOPICS`. -}
accessibilityTopics : List AccessibilityTopic
accessibilityTopics =
    [ { id = "keyboard"
      , heading = "Keyboard"
      , summary = "Onyx supports full keyboard traversal for the main chat, navigation, settings, and command surfaces."
      , points =
            [ "The command palette opens with Cmd-K or Ctrl-K."
            , "Focusable controls keep visible focus indicators."
            , "Keyboard order follows the visual reading order of the current surface."
            ]
      }
    , { id = "motion"
      , heading = "Motion"
      , summary = "Onyx honors reduced-motion preferences and gives scene motion an explicit control."
      , points =
            [ "System reduced-motion settings are respected."
            , "Scene presentation supports Animated, Still, and Off modes; Still renders a static frame, while Off skips the background renderer."
            , "Decorative motion is treated as optional and never required for understanding content."
            ]
      }
    , { id = "contrast-color"
      , heading = "Contrast and color"
      , summary = "Onyx uses an OKLCH theme system with mechanically-derived high-contrast variants."
      , points =
            [ "The interface honors prefers-contrast: more."
            , "Transparency-sensitive surfaces honor prefers-reduced-transparency where supported."
            , "Windows forced-colors mode receives system-color fallbacks instead of theme-only colors."
            ]
      }
    , { id = "screen-readers"
      , heading = "Screen readers"
      , summary = "Onyx exposes chat activity and controls with semantic labels where the UI is interactive."
      , points =
            [ "The message log is an aria-live region for new chat activity."
            , "Reconnect feedback uses polite phase-only announcements while keeping the changing countdown visual, then briefly confirms Back online."
            , "Icon-only and compact controls are labeled for assistive technology."
            , "Headings, landmarks, lists, and button elements are used before custom roles."
            ]
      }
    , { id = "client-surfaces"
      , heading = "Current client audit"
      , summary = "Dense app panels are tracked inside Preferences and mirrored here as pass evidence lands."
      , points = clientSurfacePoints
      }
    ]


{-| The audited client surfaces, kept separate so the topic table
stays readable. -}
clientSurfacePoints : List String
clientSurfacePoints =
    [ "Room settings uses a labelled Sheet, labelled forms, switch-mode flags, and read-only non-op fallbacks."
    , "Voice controls use a toolbar, grouped labelled controls, aria-pressed media state, and a live call timer."
    , "The mini voice view renders at most five avatars while its participant, hidden, and speaking counts reflect the full case-insensitive room roster."
    , "Appearance uses radio groups for themes and backgrounds with labelled swatches and modal focus handling."
    , "Home catch-up exposes recaps, reviewed ranges, and the room directory as labelled card lists with direct action buttons."
    , "Message search uses a search landmark, labelled match navigation, and named archived/device-memory result lists."
    , "Notification center uses a named inbox dialog, labelled notification list, and row-specific open/dismiss actions."
    , "Room browser uses a Sheet dialog, named directory search, labelled public-room list, and target-specific Join/Open actions."
    , "Account panel groups account management into named regions with alert/status feedback and target-specific persona actions."
    , "Room sidebar uses a complementary navigation landmark, roving room and DM rows, unread/mention names, and a target-specific join action."
    , "Keyboard shortcuts uses a named Sheet dialog, labelled close action, grouped shortcut lists generated from the live keymap, and J/K transcript navigation."
    , "Command palette uses a named dialog, described grammar examples, live selected-command status, and literal goto/search/time/reader/mute actions."
    , "Pinned messages uses a named Sheet dialog, room-specific pins list, target-specific jump buttons, and real unpin controls."
    , "Theme import uses a named Sheet dialog, described theme-code input, target-specific import and copy actions, and invalid-code feedback."
    , "Thread panel uses a named Sheet dialog, labelled parent and reply articles, and a reply log scoped to the source message."
    , "Voice settings uses a named Sheet dialog, labelled device/processing/push-to-talk regions, described selects, and target-specific push-to-talk key actions."
    , "Call overlays use named incoming/outgoing dialogs with target-specific accept, decline, and cancel actions."
    , "Message actions use per-row action groups, named reaction and overflow triggers, labelled menus, and row-specific action names."
    , "Member list uses a room-scoped complementary landmark, labelled role groups, named member-detail dialogs, target-specific member actions, decorative avatars, and focus retention across MODE/PART."
    , "Notification controls use a labelled compact control group, described calm-mode radios, and pressed-state desktop, sound, push, and do-not-disturb toggles."
    , "Time scrubber uses a room-scoped region, labelled UTC-hour jump buttons, a date jump input, and a target-specific moment-copy action."
    , "Jump to date uses a named Sheet dialog, UTC date/time fields, quick-date presets, target-specific jump and moment-copy actions, and ribbon/composer openers."
    , "Watch together uses named review and host-control groups, a bounded participant list, polite atomic outcome status, and focus restoration after successful or stale confirmations."
    , "Reader memory uses a named device-memory region, reviewed-span and context-trail groups, labelled transcript jumps, and cross-room peer-review handoffs with focus-visible dense rows."
    , "Preferences dense rows use segmented radio groups and switch controls with concise names, descriptions, keyboard roving, focus-visible outlines, forced-colors selected states, and dense-zoom reflow of category tabs."
    , "Message transcript uses a named live log, focusable articles, and state-aware accessible names that surface queued, edited, deleted, locked, and mention states without exposing E2EE ciphertext, with decorative avatars and thread-panel body parity."
    ]


{-| Static conformance statement, mirroring `AccessibilityStatement`.
`extraClass` carries the oracle's `class` prop (e.g. `ab-a11y`). -}
accessibilityStatement : String -> Html Msg
accessibilityStatement extraClass =
    let
        rootClass =
            if String.isEmpty extraClass then
                "a11y-statement"

            else
                "a11y-statement " ++ extraClass

        topicSection topic =
            section [ class "a11y-topic", attribute "aria-labelledby" ("a11y-" ++ topic.id ++ "-title") ]
                [ h4 [ id ("a11y-" ++ topic.id ++ "-title") ] [ text topic.heading ]
                , p [] [ text topic.summary ]
                , ul [ class "a11y-list" ] (List.map (\point -> li [] [ text point ]) topic.points)
                ]
    in
    div [ class rootClass ]
        [ article [ class "a11y-document" ]
            [ header [ class "a11y-header" ]
                [ p [ class "a11y-kicker" ] [ text "Accessibility conformance" ]
                , h2 [ id "a11y-statement-title" ] [ text "Accessibility statement" ]
                , p [ class "a11y-lede" ]
                    [ text "Onyx aims to make time-native chat usable without requiring a mouse, animation, perfect color perception, or a specific display mode." ]
                ]
            , section [ class "a11y-section", attribute "aria-labelledby" "a11y-posture-title" ]
                [ h3 [ id "a11y-posture-title" ] [ text "Conformance posture" ]
                , section [ class "a11y-standard", attribute "aria-labelledby" "a11y-standard-title" ]
                    [ h4 [ id "a11y-standard-title" ] [ text "Standard" ]
                    , p []
                        [ text "Onyx targets "
                        , strong [] [ text "WCAG 2.2 Level AA" ]
                        , text " and uses "
                        , strong [] [ text "EN 301 549" ]
                        , text " as the accessibility reference for EU Accessibility Act readiness."
                        ]
                    , ul [ class "a11y-list" ]
                        [ li [] [ text "Onyx treats conformance as an active product requirement." ]
                        , li [] [ text "This statement describes the Onyx client interface and its built-in interaction patterns." ]
                        ]
                    ]
                ]
            , section [ class "a11y-section", attribute "aria-labelledby" "a11y-support-title" ]
                [ h3 [ id "a11y-support-title" ] [ text "Supported accessibility features" ]
                , div [ class "a11y-topic-list" ] (List.map topicSection accessibilityTopics)
                ]
            , section [ class "a11y-section", attribute "aria-labelledby" "a11y-feedback-title" ]
                [ h3 [ id "a11y-feedback-title" ] [ text "Feedback" ]
                , section [ class "a11y-feedback", attribute "aria-labelledby" "a11y-reporting-title" ]
                    [ h4 [ id "a11y-reporting-title" ] [ text "Reporting accessibility bugs" ]
                    , p []
                        [ text "Onyx welcomes accessibility bug reports through your community's admin or an "
                        , code [] [ text "#accessibility" ]
                        , text " room so issues can be reproduced and prioritized."
                        ]
                    ]
                ]
            ]
        ]


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "Community" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Rooms, messages, and calls" ]
        ]


{-| The about body. -}
view : Html Msg
view =
    div [ class "ui-root r ab-ocean" ]
        [ section [ class "r-wrap ab-hero", attribute "aria-labelledby" "about-hero-heading" ]
            [ div [ class "ab-hero__story" ]
                [ p [ class "ab-kicker" ] [ text "A community for real conversations" ]
                , h1 [ id "about-hero-heading" ] [ text "Rooms for people you already like." ]
                , p [ class "ab-lede" ] [ text "Friends, clubs, and creators hanging out — not a status board." ]
                , div [ class "ab-seam", attribute "aria-hidden" "true" ] []
                , p [ class "sub" ]
                    [ text "Onyx is a place for rooms, messages, and calls. Private DMs when a conversation should stay between two people. No ads. Open it in your browser, then invite the people you already know." ]
                , div [ class "ab-cta" ]
                    [ a [ class "r-btn primary", href "/app/" ] [ text "Open Onyx" ]
                    , a [ class "r-btn ghost", href "/invite/" ] [ text "Join with an invite" ]
                    ]
                ]
            , figure [ class "ab-scene", attribute "aria-labelledby" "about-scene-caption" ]
                [ div [ class "ab-scene__topline" ]
                    [ span [] [ text "Onyx room" ]
                    , span [] [ text "Product sketch" ]
                    ]
                , div [ class "ab-scene__body" ]
                    [ div [ class "ab-scene__room-mark", attribute "aria-hidden" "true" ]
                        [ span [] []
                        , span [] []
                        ]
                    , div [ class "ab-scene__conversation" ]
                        [ p [ class "ab-scene__label" ] [ text "Conversation first" ]
                        , p [ class "ab-scene__title" ] [ text "Messages stay with the room." ]
                        , p [ class "ab-scene__copy" ] [ text "Calls are there when voice or a face is easier than typing." ]
                        ]
                    ]
                , div [ class "ab-scene__tools", attribute "aria-hidden" "true" ]
                    [ span [] [ text "Rooms" ]
                    , span [] [ text "Messages" ]
                    , span [] [ text "Calls" ]
                    ]
                , figcaption [ id "about-scene-caption" ]
                    [ text "One place for the conversation, with calls when you choose them. This is an explanation, not a live room." ]
                ]
            ]
        , nav [ class "r-wrap ab-topics", attribute "aria-label" "About topics" ]
            [ a [ href "#rooms" ] [ text "Rooms" ]
            , a [ href "#people" ] [ text "People" ]
            , a [ href "#join" ] [ text "Join" ]
            , a [ href "#hosting" ] [ text "Hosting" ]
            , a [ href "#accessibility" ] [ text "Accessibility" ]
            ]
        , section [ id "rooms", class "r-wrap ab-section", attribute "aria-labelledby" "rooms-heading" ]
            [ div [ class "ab-section__intro" ]
                [ p [ class "ab-eyebrow" ] [ text "Rooms, messages, and calls" ]
                , h2 [ id "rooms-heading", class "ab-title" ] [ text "A room that stays open" ]
                ]
            , div [ class "ab-section__body" ]
                [ div [ class "ab-reading" ]
                    [ p [ class "ab-copy" ]
                        [ text "Text rooms are the everyday place. People drop in, catch up, and leave the conversation where they found it. Messages stay with the room — not a feed that buries them." ]
                    , p [ class "ab-copy" ]
                        [ text "Direct messages are private when you want a quieter thread. Calls are there when a voice or a face is easier than typing. You join a call on purpose; the room does not turn into a meeting product." ]
                    ]
                , ul [ class "ab-pillars", attribute "aria-label" "What you get" ]
                    [ li [] [ strong [] [ text "Rooms" ], span [] [ text "Places to hang out that stay open." ] ]
                    , li [] [ strong [] [ text "Messages" ], span [] [ text "Room chat and private DMs." ] ]
                    , li [] [ strong [] [ text "Calls" ], span [] [ text "Voice, video, and screen when you need them." ] ]
                    , li [] [ strong [] [ text "No ads" ], span [] [ text "Nobody is selling your attention here." ] ]
                    ]
                ]
            ]
        , section [ id "people", class "r-wrap ab-section ab-section--people", attribute "aria-labelledby" "people-heading" ]
            [ div [ class "ab-section__intro" ]
                [ p [ class "ab-eyebrow" ] [ text "Who it is for" ]
                , h2 [ id "people-heading", class "ab-title" ] [ text "Friends, clubs, creators" ]
                ]
            , div [ class "ab-section__body" ]
                [ p [ class "ab-copy" ]
                    [ text "Onyx is for people who want a room of their own — not a protocol desk and not a storefront." ]
                , div [ class "ab-who", attribute "role" "list" ]
                    [ article [ class "ab-who-card", attribute "role" "listitem" ]
                        [ h3 [] [ text "Friends" ]
                        , p [] [ text "A standing room for the group chat that should not evaporate every few months." ]
                        ]
                    , article [ class "ab-who-card", attribute "role" "listitem" ]
                        [ h3 [] [ text "Clubs" ]
                        , p [] [ text "The same place every week — topics, people, and a call when the meeting starts." ]
                        ]
                    , article [ class "ab-who-card", attribute "role" "listitem" ]
                        [ h3 [] [ text "Creators" ]
                        , p [] [ text "A room and a stage for the people who already showed up, without ads in the way." ]
                        ]
                    ]
                , aside [ class "ab-quiet-note" ]
                    [ img [ class "ab-mascot", src "/brand/mascot-still.png", width 148, height 148, alt "", attribute "decoding" "async" ] []
                    , p [] [ text "A quiet harbor. The rooms stay open when you come back." ]
                    ]
                ]
            ]
        , section [ id "join", class "r-wrap ab-section", attribute "aria-labelledby" "join-heading" ]
            [ div [ class "ab-section__intro" ]
                [ p [ class "ab-eyebrow" ] [ text "How to join" ]
                , h2 [ id "join-heading", class "ab-title" ] [ text "Open it. Invite people." ]
                ]
            , div [ class "ab-section__body" ]
                [ div [ class "ab-reading" ]
                    [ p [ class "ab-copy" ]
                        [ text "The door is the browser. Open Onyx, pick a name, and walk into a room. If someone sent you an invite, use it — you land in their room with the context they shared." ]
                    , p [ class "ab-copy" ]
                        [ text "On a phone or laptop, supporting browsers can keep Onyx on this device from the same page. Same rooms, same people, no extra store." ]
                    ]
                , div [ class "ab-cta ab-cta--section" ]
                    [ a [ class "r-btn primary", href "/app/" ] [ text "Join in the browser" ]
                    , a [ class "r-btn ghost", href "/invite/" ] [ text "Have an invite?" ]
                    , a [ class "r-btn ghost", href "/download/" ] [ text "Get it on this device" ]
                    ]
                ]
            ]
        , section [ id "hosting", class "r-wrap ab-section", attribute "aria-labelledby" "hosting-heading" ]
            [ div [ class "ab-section__intro" ]
                [ p [ class "ab-eyebrow" ] [ text "Operators, after that" ]
                , h2 [ id "hosting-heading", class "ab-title" ] [ text "Self-host if you want to" ]
                ]
            , div [ class "ab-section__body" ]
                [ div [ class "ab-reading" ]
                    [ p [ class "ab-copy" ]
                        [ text "Most people never need this. If you run your own community and want the rooms on hardware you hold, you can self-host Onyx Server and keep the same client." ]
                    , p [ class "ab-copy" ]
                        [ text "Public status, the roadmap, and the longer operator notes live on quieter pages. They are there when you need them — they are not the personality of Onyx." ]
                    ]
                , nav [ class "ab-quiet-links", attribute "aria-label" "Quieter operator pages" ]
                    [ a [ href "/status/" ] [ text "Status" ]
                    , a [ href "/roadmap/" ] [ text "Roadmap" ]
                    , a [ href "/download/" ] [ text "Download" ]
                    ]
                ]
            ]
        , section [ id "accessibility", class "r-wrap ab-section ab-section--accessibility", attribute "aria-labelledby" "accessibility-heading" ]
            [ div [ class "ab-section__intro" ]
                [ p [ class "ab-eyebrow" ] [ text "Accessibility" ]
                , h2 [ id "accessibility-heading", class "ab-title" ] [ text "A place you can use." ]
                ]
            , div [ class "ab-section__body" ]
                [ p [ class "ab-copy ab-a11y-intro" ]
                    [ text "Onyx aims to make time-native chat usable without requiring a mouse, animation, perfect color perception, or a specific display mode." ]
                , details [ class "ab-a11y-disclosure" ]
                    [ summary [] [ text "Read the full accessibility statement" ]
                    , div [ class "ab-a11y-disclosure__body" ]
                        [ accessibilityStatement "ab-a11y" ]
                    ]
                ]
            ]
        ]


{-| The about route inside the public frame. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/about/" "About Onyx" (Just contextLine) [ view ] ]
