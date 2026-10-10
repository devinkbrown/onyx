module LiveCapTest exposing (suite)

{-| Registration against the live node (eshmaki.me, 2026-10-10): its
CAP LS 302 reply spans three lines (two `*` continuations). The client
must answer with CAP REQ / CAP END so registration completes.
-}

import App exposing (..)
import Expect
import Test exposing (Test, test)


liveCapLs : List String
liveCapLs =
    [ ":eshmaki.me CAP * LS * :server-time message-tags echo-message sasl=PLAIN,EXTERNAL,SCRAM-SHA-256,SCRAM-SHA-512,SCRAM-SHA-512-PLUS,SESSION-TOKEN multi-prefix userhost-in-names away-notify setname extended-join chghost cap-notify invite-notify labeled-response"
    , ":eshmaki.me CAP * LS * :draft/read-marker draft/event-playback draft/typing draft/react draft/reply batch bot draft/channel-rename extended-monitor account-notify draft/account-registration=custom-account-name"
    , ":eshmaki.me CAP * LS :draft/netsplit draft/netjoin"
    ]


suite : Test
suite =
    test "a 3-line CAP LS 302 reply ends in CAP REQ (and the negotiation can finish)" <|
        \_ ->
            let
                opened =
                    Tuple.first (update (WsOpened { url = "wss://eshmaki.me:8080" }) { blank | connection = Offline, ourNick = "kn" })

                ( _, out ) =
                    update (WsBatchReceived { at = 1, lines = liveCapLs }) opened

                sent =
                    List.filterMap
                        (\o ->
                            case o of
                                SendLine l ->
                                    Just (String.trim l)

                                _ ->
                                    Nothing
                        )
                        out
            in
            Expect.equal True (List.any (\l -> String.startsWith "CAP REQ" l || l == "CAP END") sent)
                |> Expect.onFail ("sent: " ++ String.join " | " sent)
