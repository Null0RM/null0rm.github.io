---
title: KZG Commitment - How Crypto Saved Ethereum's DA?
date: 2025-12-15 15:00:00 +0900
math: true
---

# 미완성

Ethereum이 Rollup 생태계를 본격화하면서 Data Availability(DA) 문제가 드러났다. L2 Rollup은 L1 블록의 calldata를 읽어 상태 전이를 검증하는데, 블록당 calldata가 수십 MB로 폭증하면서 light client들이 이를 감당하기조차 힘들어지게 되었다. 

이 상태로는 모든 Rollup이 full node에 의존할 수 밖에 없었기 때문에, 이를 해결하기 위한 EIP-4844가 등장하였다. 

# Blob 
EIP-4844가 도입되며, transaction type 0x03을 지정받은 `Blob Carrying Transaction (Blob TX)`가 새로이 등장했다. 

Blob은 EIP-4844에서 가장 중요한 개념이라 할 수 있겠는데, `Blob`은 **`무거운 data가 압축된 data`를 저장하는 새로운 저장공간**이라고 할 수 있겠다. 
그리고 이더리움 Beacon chain의 node는 **`KZG Commitment scheme`**을 통해, Blob에 저장된 **무거운 data**에 특정 data가 포함되어있는지를 암호학적으로 검증할 수 있다. 

이번 글에서는 L2의 Rollup data가 KZG Commitment Scheme을 통해 어떻게 L1까지 도달하고, 검증받게되는지 그 과정을 다뤄볼 생각이다. 

# Dive into KZG Commitment
**notation**
$\mathbb{F}$: BLS12-381 Scalar Field
$G_1$: BLS12-381 $G_1$ Group (48 bytes)
$G_2$: BLS12-381 $G_2$ Group (96 bytes)
$e$: Pairing e: $G_1 \times G_2 \rightarrow G_T$
$\omega$: 4096th root of unity $\in \mathbb{F}$
    $\omega \equiv 1, \omega \neq 1$ for $0 < k < 4096$
$\tau$: trusted setup에서 선택된 secret $\in \mathbb{F}$

## 1. Rollup data -> Polynomial 
L2 Sequencer는 우선 처음으로, blob에 넣을 데이터를 생성해주게 된다. 그 데이터의 종류는 rollup의 종류마다 다른데, 대표적으로 아래와 같다고 보면 된다. 
- Optimism: Compressed tx batch
- ZKSync: State delta + proof
- Arbitrum: State root 변화 record
=> bytes[131072] (=2^17)

이 rollup data는 4096 byte로 이루어져 있는데, 이는 아래와 같이 Blob 리스트로 변환되는 과정을 거친다. 
$$
b_0 = bytes[0:32] mod q
b_1 = bytes[32:64] mod q
...
b_{4095} = bytes[130048:131072] mod q

\rightarrow Blob = [b_0,b_1,...,b_{4095}] \in \mathbb{F}^{4096}
$$

이제 각 Blob element들을 Polynomial에 매핑시켜주기 위해 아래 과정을 거쳐준다. 
$$
P(\omega^0) = b_0
P(\omega^1) = b_1
...
P(\omega^4095) = b_{4095}
$$
즉, polynomial의 domain(정의역)은 $\omega^i$ (i=0,1,...,4095)가 되고, 이에 대한 매핑은 $b^i$ (i=0,1,...,4095)가 된다. 

이렇게 관계가 만들어졌으면, 이를 바탕으로 **유일한** Polynomial을 만들 수 있다. (**유일한** Polynomial이 만들어지는 이유는 중고등학교에서 잘 배우니까... 생략하도록 하겠다.) 아래와 같이 표현한다. 
$$P(x) = \Sigma_{i=0}^{4095}c_ix^i$$

