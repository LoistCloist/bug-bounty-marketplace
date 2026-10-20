import pytest

from analysis.config import load_supported_solc
from analysis.solc import UnsupportedSolcError, pick_solc

S = load_supported_solc()


def test_caret_picks_highest_compatible():
    assert pick_solc(b"pragma solidity ^0.8.19;", S) == "0.8.28"


def test_exact_version():
    assert pick_solc(b"pragma solidity 0.8.19;", S) == "0.8.19"


def test_equals_exact_version():
    assert pick_solc(b"pragma solidity =0.8.19;", S) == "0.8.19"


def test_bounded_range():
    assert pick_solc(b"pragma solidity >=0.8.0 <0.8.21;", S) == "0.8.20"


def test_range_below_08_picks_076():
    assert pick_solc(b"pragma solidity >=0.7.0 <0.8.0;", S) == "0.7.6"


def test_or_range():
    assert pick_solc(b"pragma solidity ^0.8.0 || ^0.7.0;", S) == "0.8.28"


def test_no_pragma_uses_latest():
    assert pick_solc(b"contract A {}", S) == "0.8.28"


def test_unsupported_version_raises_with_pragma_text():
    with pytest.raises(UnsupportedSolcError) as exc:
        pick_solc(b"pragma solidity ^0.6.0;", S)
    assert str(exc.value) == "Unsupported Solidity version: ^0.6.0"


def test_bom_and_crlf():
    assert pick_solc(b"\xef\xbb\xbfpragma solidity ^0.8.19;\r\ncontract A {}\r\n", S) == "0.8.28"


def test_invalid_utf8_elsewhere_is_ignored():
    source = b"// bad bytes \xff\xfe here\npragma solidity ^0.8.19;\ncontract A {}"
    assert pick_solc(source, S) == "0.8.28"


def test_pragma_in_line_comment_is_ignored():
    source = b"// pragma solidity ^0.6.0;\npragma solidity ^0.8.19;"
    assert pick_solc(source, S) == "0.8.28"


def test_pragma_in_block_comment_is_ignored():
    source = b"/* pragma solidity ^0.6.0; */\npragma solidity 0.8.20;"
    assert pick_solc(source, S) == "0.8.20"


def test_block_comment_opener_inside_a_line_comment_does_not_hide_the_pragma():
    source = b"// deploy with scripts/*.js\npragma solidity 0.7.6;\ncontract A {}\n/* note */\n"
    assert pick_solc(source, S) == "0.7.6"


def test_line_comment_marker_inside_a_block_comment_is_ignored():
    source = b"/* see http://example.com */\npragma solidity 0.8.20;"
    assert pick_solc(source, S) == "0.8.20"


def test_pick_solc_for_all_satisfies_every_pragma():
    from analysis.solc import pick_solc_for_all

    target = b"pragma solidity ^0.8.19;"
    poc = b"pragma solidity 0.8.20;"
    assert pick_solc_for_all([target, poc], S) == "0.8.20"
    assert pick_solc_for_all([target, b"contract T {}"], S) == "0.8.28"


def test_pick_solc_for_all_names_both_pragmas_when_none_fits():
    from analysis.solc import pick_solc_for_all

    with pytest.raises(UnsupportedSolcError) as exc:
        pick_solc_for_all([b"pragma solidity ^0.8.19;", b"pragma solidity ^0.7.0;"], S)
    assert str(exc.value) == "No supported Solidity version satisfies all of: ^0.8.19, ^0.7.0"
