module SearchTest exposing (suite)

{-| Vectors for the message-search slice, mirroring
`src/shell/search/useMessageSearch.ts` (live tier + recall
suggestions + exact-mode vault hits) + `src/lib/vault/searchBounds.ts`
+ the `MessageSearch.tsx` chrome: bounded input, visible-text gating,
live filtering, wraparound navigation, count/status labels, panel
folds, the saved-search run/save/delete wiring, recall term
extraction, ranking, chips, the app pivot, and the remembered-elsewhere
vault section with open-at-stamp rows.
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Route
import SavedSearches
import Search exposing (..)
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


channelModel : Model
channelModel =
    blank
        |> (\m -> feed m ":me!u@h JOIN #c")
        |> (\m -> feed m ":alice!u@h JOIN #c")
        |> (\m -> feed m ":bob!u@h PRIVMSG #c :hello world")
        |> (\m -> feed m ":carol!u@h PRIVMSG #c :goodnight moon")
        |> (\m -> feed m ":bob!u@h PRIVMSG #c :HELLO again")
        |> (\m -> Tuple.first (update (ChannelSelect "#c") m))


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


row : Int -> String -> String -> Maybe String -> { id : Int, from : String, body : String, plaintext : Maybe String }
row id from body plaintext =
    { id = id, from = from, body = body, plaintext = plaintext }


suite : Test
suite =
    describe "Message search"
        [ describe "bounds"
            [ test "query input keeps spaces but caps at 512" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "  hi there  " (boundQueryInput "  hi there  ")
                        , \_ -> Expect.equal 512 (String.length (boundQueryInput (String.repeat 600 "a")))
                        ]
                        ()
            , test "surrogate cut never splits a pair" <|
                \_ ->
                    -- U+1F30A (surrogate pair) at the cut edge drops whole.
                    safeSlice 3 "ab🌊cd"
                        |> Expect.equal "ab"
            , test "result bodies window around the match" <|
                \_ ->
                    let
                        body =
                            String.repeat 5000 "x" ++ "needle" ++ String.repeat 5000 "y"

                        windowed =
                            resultText body "needle"
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (String.length windowed <= maxResultTextLength)
                        , \_ -> Expect.equal True (String.contains "needle" windowed)
                        , \_ -> Expect.equal True (String.startsWith "…" windowed)
                        , \_ -> Expect.equal True (String.endsWith "…" windowed)
                        ]
                        ()
            , test "short bodies pass through untouched" <|
                \_ ->
                    resultText "hello" "ell"
                        |> Expect.equal "hello"
            ]
        , describe "live filter"
            [ test "empty query matches nothing" <|
                \_ ->
                    filterLive "   " [ row 1 "bob" "hello" Nothing ]
                        |> Expect.equal []
            , test "text and sender match case-insensitively" <|
                \_ ->
                    let
                        rows =
                            [ row 1 "bob" "hello world" Nothing
                            , row 2 "carol" "goodnight" Nothing
                            ]
                    in
                    Expect.all
                        [ \_ ->
                            filterLive "HELLO" rows
                                |> List.map .id
                                |> Expect.equal [ 1 ]
                        , \_ ->
                            filterLive "carol" rows
                                |> List.map .id
                                |> Expect.equal [ 2 ]
                        ]
                        ()
            , test "locked envelopes never match" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            visibleText { body = "ciphertext", plaintext = Just "hello there" }
                                |> Expect.equal (Just "hello there")
                        , \_ ->
                            filterLive "sealed"
                                [ row 1 "bob" "ONYXDM1 sealed-box" Nothing ]
                                |> Expect.equal []
                        ]
                        ()
            , test "mode copy follows the wire strings" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Exact text" (modeLabel "exact")
                        , \_ -> Expect.equal "Text + related terms" (modeLabel "hybrid")
                        , \_ -> Expect.equal "Related terms" (modeLabel "semantic")
                        , \_ -> Expect.equal "Related terms" (modeLabel "mystery")
                        ]
                        ()
            ]
        , describe "navigation"
            [ test "move wraps both directions and parks when empty" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 2 (moveIndex 1 3 1)
                        , \_ -> Expect.equal 0 (moveIndex 1 3 2)
                        , \_ -> Expect.equal 2 (moveIndex -1 3 0)
                        , \_ -> Expect.equal 0 (moveIndex 1 0 0)
                        ]
                        ()
            , test "clamp and position honor the list" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 1 (clampIndex 2 7)
                        , \_ -> Expect.equal 0 (clampIndex 0 7)
                        , \_ -> Expect.equal 2 (activePosition 3 1)
                        , \_ -> Expect.equal 0 (activePosition 0 0)
                        ]
                        ()
            , test "count and status labels" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "2 of 3" (countLabel 3 2)
                        , \_ -> Expect.equal "0 of 0" (countLabel 0 0)
                        , \_ -> Expect.equal "Search #c" (statusLabel "" "#c" 0 0)
                        , \_ ->
                            Expect.equal "No visible matches for “zzz” in #c"
                                (statusLabel "zzz" "#c" 0 0)
                        , \_ ->
                            Expect.equal "1 of 2 for “hel” in #c"
                                (statusLabel "hel" "#c" 2 1)
                        ]
                        ()
            ]
        , describe "panel fold"
            [ test "query input bounds and restarts at the first match" <|
                \_ ->
                    let
                        ( m, _ ) =
                            update (SearchQuery { query = "hello" }) { channelModel | searchIndex = 2 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "hello" m.searchQuery
                        , \_ -> Expect.equal 0 m.searchIndex
                        ]
                        ()
            , test "next and previous wrap over live matches" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update (SearchQuery { query = "hello" }) channelModel)
                    in
                    Expect.all
                        [ \_ ->
                            -- hello world + HELLO again = 2 matches.
                            List.length (searchResults open)
                                |> Expect.equal 2
                        , \_ ->
                            update SearchNext open
                                |> Tuple.first
                                |> .searchIndex
                                |> Expect.equal 1
                        , \_ ->
                            update SearchNext open
                                |> Tuple.first
                                |> (\m -> update SearchNext m)
                                |> Tuple.first
                                |> .searchIndex
                                |> Expect.equal 0
                        , \_ ->
                            update SearchPrevious open
                                |> Tuple.first
                                |> .searchIndex
                                |> Expect.equal 1
                        ]
                        ()
            , test "channel switch restarts navigation" <|
                \_ ->
                    update (ChannelSelect "#other") { channelModel | searchIndex = 1 }
                        |> Tuple.first
                        |> .searchIndex
                        |> Expect.equal 0
            , test "save current validates label and query" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            update SearchSaveCurrent channelModel
                                |> Tuple.second
                                |> Expect.equal []
                        , \_ ->
                            update (SearchQuery { query = "hello" }) channelModel
                                |> Tuple.first
                                |> (\m -> update (SearchSaveName { name = "  greetings  " }) m)
                                |> Tuple.first
                                |> (\m -> update SearchSaveCurrent m)
                                |> Expect.all
                                    [ \( m, _ ) -> Expect.equal "" m.searchSaveName
                                    , \( _, out ) ->
                                        Expect.equal
                                            [ SearchSave { label = "greetings", query = "hello", mode = "exact" } ]
                                            out
                                    ]
                        ]
                        ()
            , test "run saved replays its query" <|
                \_ ->
                    let
                        seeded =
                            { channelModel
                                | savedSearches =
                                    [ { id = "s1"
                                      , label = "Greetings"
                                      , query = "hello"
                                      , mode = SavedSearches.ExactMode
                                      , createdAt = 0
                                      }
                                    ]
                            }
                    in
                    Expect.all
                        [ \_ ->
                            update (SearchRunSaved { id = "s1" }) seeded
                                |> Tuple.first
                                |> .searchQuery
                                |> Expect.equal "hello"
                        , \_ ->
                            update (SearchRunSaved { id = "nope" }) seeded
                                |> Tuple.first
                                |> .searchQuery
                                |> Expect.equal ""
                        ]
                        ()
            , test "delete saved emits the store delete" <|
                \_ ->
                    update (SearchDeleteSaved { id = "s1" }) channelModel
                        |> Tuple.second
                        |> Expect.equal [ SearchDelete { id = "s1" } ]
            ]
        , describe "panel view"
            [ test "topbar trigger opens the panel" <|
                \_ ->
                    query channelModel
                        |> Query.find
                            [ Selector.tag "button"
                            , Selector.containing [ Selector.text "Search" ]
                            ]
                        |> Event.simulate Event.click
                        |> Event.expect SearchOpen
            , test "open panel renders query chrome and scope" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update SearchOpen channelModel)
                    in
                    Expect.all
                        [ \q -> q |> Query.has [ Selector.attribute (Attr.attribute "role" "search") ]
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "message-search-target") ]
                                |> Query.has [ Selector.text "#c" ]
                        , \q -> q |> Query.has [ Selector.text "0 of 0" ]
                        ]
                        (query open)
            , test "typing filters and navigation steps through matches" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update (SearchQuery { query = "hello" }) { channelModel | searchOpen = True })
                    in
                    Expect.all
                        [ \q -> q |> Query.has [ Selector.text "1 of 2" ]
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Next match") ]
                                |> Event.simulate Event.click
                                |> Event.expect SearchNext
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Previous match") ]
                                |> Event.simulate Event.click
                                |> Event.expect SearchPrevious
                        , \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__input" ]
                                |> Event.simulate (Event.input "goodnight")
                                |> Event.expect (SearchQuery { query = "goodnight" })
                        ]
                        (query open)
            , test "active match highlights its thread row" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update (SearchQuery { query = "goodnight" }) { channelModel | searchOpen = True })
                    in
                    query open
                        |> Query.findAll [ Selector.class "onyx-message-search-current" ]
                        |> Query.count (Expect.equal 1)
            , test "input keys step and close" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update SearchOpen channelModel)

                        key name shift =
                            Event.custom "keydown"
                                (Encode.object
                                    [ ( "key", Encode.string name )
                                    , ( "shiftKey", Encode.bool shift )
                                    , ( "ctrlKey", Encode.bool False )
                                    , ( "metaKey", Encode.bool False )
                                    ]
                                )
                    in
                    Expect.all
                        [ \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__input" ]
                                |> Event.simulate (key "Enter" False)
                                |> Event.expect SearchNext
                        , \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__input" ]
                                |> Event.simulate (key "Enter" True)
                                |> Event.expect SearchPrevious
                        , \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__input" ]
                                |> Event.simulate (key "Escape" False)
                                |> Event.expect SearchClose
                        ]
                        (query open)
            , test "saved rows run and delete" <|
                \_ ->
                    let
                        seeded =
                            { channelModel
                                | searchOpen = True
                                , savedSearches =
                                    [ { id = "s1"
                                      , label = "Greetings"
                                      , query = "hello"
                                      , mode = SavedSearches.ExactMode
                                      , createdAt = 0
                                      }
                                    ]
                            }
                    in
                    Expect.all
                        [ \q ->
                            q
                                |> Query.find
                                    [ Selector.tag "button"
                                    , Selector.containing [ Selector.text "Greetings" ]
                                    ]
                                |> Event.simulate Event.click
                                |> Event.expect (SearchRunSaved { id = "s1" })
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "aria-label" "Delete saved search Greetings") ]
                                |> Event.simulate Event.click
                                |> Event.expect (SearchDeleteSaved { id = "s1" })
                        ]
                        (query seeded)
            , test "remembered-elsewhere section lists vault hits" <|
                \_ ->
                    let
                        hit =
                            { id = "#b:9", from = "bob", text = "hello orchard", at = 1791115200000, target = "#b" }

                        seeded =
                            { channelModel
                                | searchOpen = True
                                , searchQuery = "hello"
                                , vaultRawHits = [ hit ]
                                , vaultStatus = VaultSearchDone
                            }
                    in
                    Expect.all
                        [ \q -> q |> Query.has [ Selector.text "Remembered elsewhere" ]
                        , \q -> q |> Query.has [ Selector.text "Saved on this device" ]
                        , \q -> q |> Query.has [ Selector.text "1 remembered" ]
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "vault-search") ]
                                |> Query.has [ Selector.text "#b", Selector.text "bob", Selector.text "hello orchard", Selector.text "12:00" ]
                        , \q -> q |> Query.has [ Selector.text "Device-memory search complete with 1 remembered match." ]
                        ]
                        (query seeded)
            , test "vault section labels the mode and toggles it" <|
                \_ ->
                    let
                        hit =
                            { id = "#b:9", from = "bob", text = "hello orchard", at = 1791115200000, target = "#b" }

                        seeded =
                            { channelModel
                                | searchOpen = True
                                , searchQuery = "hello"
                                , vaultRawHits = [ hit ]
                                , vaultStatus = VaultSearchDone
                            }
                    in
                    Expect.all
                        [ \q -> q |> Query.has [ Selector.text "1 remembered · hybrid" ]
                        , \q -> q |> Query.has [ Selector.text "Mode: hybrid" ]
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "title" "Switch device-memory search mode (hybrid, exact, semantic)") ]
                                |> Event.simulate Event.click
                                |> Event.expect CycleVaultSearchMode
                        ]
                        (query seeded)
            , test "vault row opens its conversation at its stamp" <|
                \_ ->
                    let
                        hit =
                            { id = "#b:9", from = "bob", text = "hello orchard", at = 1791115200000, target = "#b" }

                        seeded =
                            { channelModel
                                | searchOpen = True
                                , searchQuery = "hello"
                                , vaultRawHits = [ hit ]
                                , vaultStatus = VaultSearchDone
                            }
                    in
                    query seeded
                        |> Query.find [ Selector.attribute (Attr.attribute "title" "Open #b at this message") ]
                        |> Event.simulate Event.click
                        |> Event.expect (VaultOpenHit { target = "#b", at = 1791115200000 })
            , test "empty vault hides the section but keeps the status line" <|
                \_ ->
                    let
                        seeded =
                            { channelModel | searchOpen = True, searchQuery = "hello", vaultStatus = VaultSearchPending }
                    in
                    Expect.all
                        [ \q -> q |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "vault-search") ]
                        , \q -> q |> Query.has [ Selector.text "Searching device memory for “hello”." ]
                        ]
                        (query seeded)
            , test "archived section runs deep search and lists results" <|
                \_ ->
                    let
                        hit =
                            { id = "n9", from = "bob", text = "hello archived", at = 1791115200000, target = "#c" }

                        seeded =
                            { channelModel
                                | searchOpen = True
                                , searchQuery = "hello"
                                , caps = [ "draft/search" ]
                                , serverSearchTarget = "#c"
                                , serverSearchQuery = "hello"
                                , serverSearchStatus = ServerSearchDone
                                , serverSearchResults = [ hit ]
                            }
                    in
                    Expect.all
                        [ \q -> q |> Query.has [ Selector.text "Archived history" ]
                        , \q -> q |> Query.has [ Selector.text "1 archived match" ]
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "server-search") ]
                                |> Query.has [ Selector.text "bob", Selector.text "hello archived", Selector.text "12:00" ]
                        , \q -> q |> Query.has [ Selector.text "Full-history search complete with 1 archived match." ]
                        , \q ->
                            q
                                |> Query.find [ Selector.attribute (Attr.attribute "title" "Open archived context and jump to this message") ]
                                |> Event.simulate Event.click
                                |> Event.expect (ServerOpenResult { target = "#c" })
                        , \q ->
                            q
                                |> Query.find
                                    [ Selector.attribute (Attr.attribute "title" "Search the server's full history for this conversation (Ctrl+Enter)") ]
                                |> Event.simulate Event.click
                                |> Event.expect SearchRunServer
                        ]
                        (query seeded)
            , test "archived section hides without cap" <|
                \_ ->
                    let
                        noCap =
                            { channelModel | searchOpen = True, searchQuery = "hello" }
                    in
                    query noCap
                        |> Query.hasNot [ Selector.attribute (Attr.attribute "data-testid" "server-search") ]
            , test "designated DM shows the device-only notice" <|
                \_ ->
                    let
                        blocked =
                            { channelModel
                                | searchOpen = True
                                , searchQuery = "hello"
                                , activeChannel = Just "dave"
                                , peerKeyChanges = Set.fromList [ "dave" ]
                            }
                    in
                    query blocked
                        |> Query.has [ Selector.text "Encrypted DM search stays on this device." ]
            , test "ctrl+enter runs the deep search" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update SearchOpen channelModel)

                        key ctrl meta =
                            Event.custom "keydown"
                                (Encode.object
                                    [ ( "key", Encode.string "Enter" )
                                    , ( "shiftKey", Encode.bool False )
                                    , ( "ctrlKey", Encode.bool ctrl )
                                    , ( "metaKey", Encode.bool meta )
                                    ]
                                )
                    in
                    Expect.all
                        [ \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__input" ]
                                |> Event.simulate (key True False)
                                |> Event.expect SearchRunServer
                        , \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__input" ]
                                |> Event.simulate (key False True)
                                |> Event.expect SearchRunServer
                        ]
                        (query open)
            ]
        , describe "recall suggestions"
            [ test "terms split on runs, strip hyphens, dedupe" <|
                \_ ->
                    Expect.equal [ "hello", "well-known", "actor", "lead" ]
                        (recallTermsFromText "Hello, hello! well-known actor --lead a-")
            , test "stop-words drop while short words drop by length" <|
                \_ ->
                    Expect.equal [ "the", "quick" ]
                        (recallTermsFromText "the quick note: go to it")
            , test "non-ASCII letters form terms" <|
                \_ ->
                    Expect.equal [ "café", "lait" ]
                        (recallTermsFromText "café au lait")
            , test "short queries suggest nothing" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [] (recallSuggestions "" [ "hello world" ])
                        , \_ -> Expect.equal [] (recallSuggestions "h" [ "hello world" ])
                        ]
                        ()
            , test "query-covered terms stay out, rest rank by count then term" <|
                \_ ->
                    Expect.equal [ "world", "goodbye", "peace" ]
                        (recallSuggestions "hello" [ "hello world", "hello world peace", "goodbye world" ])
            , test "full query string blocks multi-word matches" <|
                \_ ->
                    Expect.equal [ "talks" ]
                        (recallSuggestions "world peace" [ "world peace talks" ])
            , test "suggestions cap at five alphabetical ties" <|
                \_ ->
                    Expect.equal [ "aaa", "bbb", "ccc", "ddd", "eee" ]
                        (recallSuggestions "qq" [ "aaa bbb ccc", "ddd eee fff ggg" ])
            , test "app pivots over live matches" <|
                \_ ->
                    let
                        seeded =
                            blank
                                |> (\m -> feed m ":me!u@h JOIN #c")
                                |> (\m -> feed m ":alice!u@h JOIN #c")
                                |> (\m -> feed m ":bob!u@h PRIVMSG #c :apple orchard")
                                |> (\m -> feed m ":carol!u@h PRIVMSG #c :apple pie")
                                |> (\m -> Tuple.first (update (ChannelSelect "#c") m))
                                |> (\m -> Tuple.first (update (SearchQuery { query = "apple" }) { m | searchOpen = True }))
                    in
                    Expect.equal [ "orchard", "pie" ] (searchRecallTerms seeded)
            , test "chips apply their term and hide on short queries" <|
                \_ ->
                    let
                        open =
                            Tuple.first (update (SearchQuery { query = "hello" }) { channelModel | searchOpen = True })
                    in
                    Expect.all
                        [ \q ->
                            q
                                |> Query.find [ Selector.class "onyx-message-search__recall-chip", Selector.containing [ Selector.text "world" ] ]
                                |> Event.simulate Event.click
                                |> Event.expect (SearchQuery { query = "world" })
                        , \q ->
                            q
                                |> Query.has [ Selector.attribute (Attr.attribute "aria-label" "Device recall terms") ]
                        ]
                        (query open)
            , test "no recall group without suggestions" <|
                \_ ->
                    query channelModel
                        |> Query.hasNot [ Selector.class "onyx-message-search__recall" ]
            ]
        , describe "slash search/history"
            [ test "registry resolves both verbs" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "search") (Maybe.map .name (findSlashCommand "search"))
                        , \_ -> Expect.equal (Just "history") (Maybe.map .name (findSlashCommand "history"))
                        ]
                        ()
            , test "/history opens the panel and clears the draft" <|
                \_ ->
                    let
                        ( opened, out ) =
                            update ComposerSend { channelModel | composer = "/history" }
                    in
                    Expect.all
                        [ \m -> Expect.equal True m.searchOpen
                        , \m -> Expect.equal "" m.composer
                        ]
                        opened
                        |> always (Expect.equal [] out)
            , test "bare /search opens the panel keeping the current query" <|
                \_ ->
                    let
                        seeded =
                            { channelModel | searchQuery = "moon", composer = "/search" }

                        ( opened, out ) =
                            update ComposerSend seeded
                    in
                    Expect.all
                        [ \_ -> Expect.equal True opened.searchOpen
                        , \_ -> Expect.equal "moon" opened.searchQuery
                        , \_ -> Expect.equal "" opened.composer
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            , test "multi-word tails join and verbs match case-insensitively" <|
                \_ ->
                    let
                        ( joined, _ ) =
                            update ComposerSend { channelModel | composer = "/search  hello   world" }

                        ( upper, _ ) =
                            update ComposerSend { channelModel | composer = "/HISTORY" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "hello   world" joined.searchQuery
                        , \_ -> Expect.equal True joined.searchOpen
                        , \_ -> Expect.equal True upper.searchOpen
                        ]
                        ()
            , test "/search with a query sets it and restarts at the first match" <|
                \_ ->
                    let
                        ( opened, out ) =
                            update ComposerSend { channelModel | composer = "/search hello", searchIndex = 2 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True opened.searchOpen
                        , \_ -> Expect.equal "hello" opened.searchQuery
                        , \_ -> Expect.equal 0 opened.searchIndex
                        , \_ -> Expect.equal "" opened.composer
                        , \_ -> Expect.equal 2 (List.length (searchResults opened))
                        , \_ -> Expect.equal [] out
                        ]
                        ()
            ]
        ]
